/*
 * PlayGround: https://playground.deepgram.com/
 */

require('dotenv').config();
const { Deepgram } = require("@deepgram/sdk");
const mime = require('mime-types');
const fs = require('fs');
const { exec } = require("child_process");

const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

const config = {  
    smart_format: true, 
    diarize: true, 
    model: 'nova', 
    language: 'en-US',
    summarize: true
};

exports.convertFileToMp4 = fileName => {
    console.log(fileName);
    return new Promise((resolve, reject) => {
        const loc = fileName.lastIndexOf('.');
        const newFile = fileName.substring(0, loc) + '.mp4';
        const command = `ffmpeg -i ${fileName} ${newFile}`;
        console.log('command', command);
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.log(`error: ${error.message}`);
                return resolve(false);
            }
            if (stderr) {
                //console.log(`stderr: ${stderr}`);
            }
            console.log(`stdout: ${stdout}`);
            return resolve(newFile);
        });
    })
}

exports.convertMp4ToMp3 = fileName => {
    console.log(fileName);
    return new Promise((resolve, reject) => {
        const loc = fileName.indexOf('.mp4');
        if (loc === -1) return reject ('invalid input file');
        const newFile = fileName.substring(0, loc) + '.mp3';
        exec(`ffmpeg -i ${fileName} ${newFile}`, (error, stdout, stderr) => {
            if (error) {
                console.log(`error: ${error.message}`);
                return reject(error.message);
            }
            if (stderr) {
                //console.log(`stderr: ${stderr}`);
            }
            console.log(`stdout: ${stdout}`);
            return resolve(newFile);
        });
    })
}

exports.transcribeRecording = async (inputFile, outputFile = null) => {
    let response;
    try {
        const mimetype = mime.lookup(inputFile);
        
        const audioSource = {
            stream: fs.createReadStream(inputFile),
            mimetype
        };
    
        response = await deepgram.transcription.preRecorded(audioSource, config);

        if (outputFile) await fs.promises.writeFile(outputFile, JSON.stringify(response));
    } catch (err) {
        console.error('Error [deepgram.js transcribeRecording]:', err.message ? err.message : err);
        return false;
    }

    return response;
}

exports.generateSpeakerBasedTranscript = info => {
    let transcript;

    try {
        transcript = info.results.channels[0].alternatives[0].paragraphs.transcript;
    } catch (err) {
        console.error('Error [deepgram.js generateSpeakerBasedTranscript]:', err.message ? err.message : err);
        return false;
    }

    return transcript;

}

exports.notableQuotes = info => {
    let summaries = info.results.channels[0].alternatives[0].summaries;
    console.log(summaries);

    let sentences = info.results.channels[0].alternatives[0].paragraphs.paragraphs;

    console.log(sentences);
}

exports.getNumWords = (str) => {
    const words = str.split(' ');
    return words.length ? words.length : 1;
}

exports.getTranscriptChunks = (speakerChunks, maxSize = 1200) => {
    const chunks = [''];
    let index = 0;
    let curSize = 0;

    for (let i = 0; i < speakerChunks.length; ++i) {
        const curChunk = speakerChunks[i];
        const chunkSize = exports.getNumWords(curChunk);
        console.log('curChunk length', chunkSize);
        if (curSize + chunkSize <= maxSize) {
            chunks[index] += curChunk;
            curSize += chunkSize;
        } else {
            chunks.push(curChunk);
            ++index;
            curSize = chunkSize;
        }
    }

    
    return chunks;
}

exports.getSpeakerChunks = (transcript) => {
    const paragraphs = transcript.split("\n");
    const speakerChunks = [];
    let curSpeaker = -1;
    let curChunk = "";

    for (let i = 0; i < paragraphs.length; ++i) {
        const paragraph = paragraphs[i];
        const speakerNumber = getSpeakerNumber(paragraph);
        if (speakerNumber === false) {
            curChunk += paragraph + "\n";
            continue;
        }
        if (curChunk.length) speakerChunks.push(curChunk);
        curChunk = paragraph + "\n";
    }
    
    if (curChunk.length) speakerChunks.push(curChunk);
    
    return speakerChunks;
}

function getSpeakerNumber (paragraph) {
    if (paragraph.startsWith('Speaker')) {
        const numberStart = 7;
        const numberEnd = paragraph.indexOf(':');
        if (numberEnd < 0) return false;
        const index = isNaN(paragraph.substring(numberStart, numberEnd)) ? -1 : Number(paragraph.substring(numberStart, numberEnd));
        if (index < 0) false;

        return index;
    }
    return false;
}

exports.assignSpeakers = (transcript, speakers) => {
    if (!speakers.length) return transcript;
    const paragraphs = transcript.split("\n");

    for (let i = 0; i < paragraphs.length; ++i) {
        const paragraph = paragraphs[i];
        index = getSpeakerNumber(paragraph);
        if (index === false) continue;
        const loc = paragraph.indexOf(':');
        if (loc === -1) continue;
        paragraphs[i] = speakers[index] + paragraph.substring(loc);
    }

    return paragraphs.join("\n");
}

exports.getSpeakers = info => {
    const paragraphs = info.results.channels[0].alternatives[0].paragraphs.paragraphs;
    const speakers = new Set();
    for (let i = 0; i < paragraphs.length; ++i) speakers.add(`Speaker ${paragraphs[i].speaker}`);
    return Array.from(speakers);
}