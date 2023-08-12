/*
 * sudo apt-get install poppler-utils
 * https://github.com/nisaacson/pdf-extract
 * https://www.npmjs.com/package/pdfreader : PDF Extractor with Table detection and parsing
*/


const fs = require('fs');
const pdf = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const readFile = fileName => {
    return new Promise((resolve, reject) => {
        fs.readFile(fileName, (err, data) => {
            if(err) resolve(false);
            resolve(data);
            return;
        })
    })
}

exports.toText = async fileName => {
    try {
        let dataBuffer = await readFile(fileName);
        if (dataBuffer === false) return false;
        let data = await pdf(dataBuffer);
        const token = uuidv4();

        data.text = data.text.replaceAll("\n\n", token).replaceAll("\n", " ").replaceAll(token, "\n");
        console.log('data.text', data);

        return data.text;
    } catch (err) {
        console.error(err);
        return false;
    }

    
}