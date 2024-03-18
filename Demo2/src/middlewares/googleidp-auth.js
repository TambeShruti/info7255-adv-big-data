const { OAuth2Client } = require('google-auth-library');
const config = require("../../config/local.json");
// const { CLIENT_ID } = 
console.log(config.CLIENT_ID);
const gClient = new OAuth2Client(config.CLIENT_ID);

const auth = async (req, res, next) => {
    try {
        if (req.headers.authorization === null) {
            return res.status(401).send('You are not authorized to access..')
        }
        const token = req.headers['authorization'].split(' ')[1]
        // console.log(token);
        const ticket = await gClient.verifyIdToken({
            idToken: token,
            audience: config.CLIENT_ID,
        })
        const payload = ticket.getPayload()
        console.log(payload.email )
        next()
    } catch (err) {
        // logger.error(`Validation error ${err}`)
        console.log(err)
        return res.status(401).send('You are not authorized to access..')
    }
}

module.exports = auth;