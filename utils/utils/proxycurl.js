require('dotenv').config();
const axios = require('axios');

exports.getLinkedInProfile = async url => {
    const request = {
        url: "https://nubela.co/proxycurl/api/v2/linkedin",
        params: {
            url: url,
            skills: 'include',
            extra: 'include'
        },
        headers: {
            Authorization: `Bearer ${process.env.PROXYCURL_KEY}`
        }
    }

    console.log(request);
}

exports.getLinkedInPhoto = async url => {
    const request = {
        url: "https://nubela.co/proxycurl/api/linkedin/person/profile-picture",
        params: {
            linkedin_person_profile_url: url
        },
        headers: {
            Authorization: `Bearer ${process.env.PROXYCURL_KEY}`
        }
    }

    try {
        response = await axios(request);
        console.log(response.data);
        console.log('proxyCurl photo', response.data.tmp_profile_pic_url)
        return response.data.tmp_profile_pic_url;
    } catch(err) {
        console.error(err);
        return ('');
    }
}