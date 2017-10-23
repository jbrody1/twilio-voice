'use strict';
var env = require('./env');
var views = require('./views');
var utils = require('./utils');
var logger = utils.logger;
var auth = require('./auth');
var email = require('./email');
var twilio = require('twilio');
var request = require('request');
var pug = require('pug');
var promise = require('promise');
var streamToPromise = require('stream-to-promise');
var watson = require('watson-developer-cloud');
var speechToText = watson.speech_to_text({
	url: 'https://stream.watsonplatform.net/speech-to-text/api',
	version: 'v1',
	username: env.watson_stt_username,
	password: env.watson_stt_password,
});

var tryFormat = function(user, phoneNumber) {
	// (try to) convert an E164 phone number to national format
	if (auth.hasTwilioAuth(user)) {
		var lookup = new twilio.LookupsClient(user.app_metadata.twilio_account_sid, user.app_metadata.twilio_auth_token);
		return promise.denodeify(lookup.phoneNumbers(phoneNumber).get)()
		.then(function(result) {
			logger.debug('lookup for phone number ' + phoneNumber, result);
			return result.national_format || phoneNumber;
		})
		.catch(function(err) {
			logger.warn('failed to lookup phone number', err);
			return phoneNumber
		});
	} else {
		return promise.resolve(phoneNumber);
	}
};
module.exports.tryFormat = tryFormat;

var transcribeWatson = function(url) {
	// transcribe a wav audio file to text using watson
	var transcript = speechToText.createRecognizeStream({
		content_type: 'audio/wav',
		model: 'en-US_NarrowbandModel',
		smart_formatting: true,
	});
	transcript.setEncoding('utf8');
	// download the audio file
	request(url).pipe(transcript);
	// stream to watson
	return streamToPromise(transcript)
	// convert response buffer to string
	.then(function(buf) {
		return buf.toString('utf8');
	})
	// replace %HESITATION with ellipses
	.then(function(str) {
		return str ? str.replace(/ %HESITATION/g, '...') : str;
	})
	.catch(function(err) {
		logger.error('watson transcription failed', err);
	});
};
module.exports.transcribeWatson = transcribeWatson;

var parseSipEndpoint = function(endpoint) {
	// parse "sip:+12345678900@sip.example.com" to "+12345678900"
	var startPos = (endpoint && (endpoint.indexOf('sip:') === 0 || endpoint.indexOf('sips:') === 0)) ? endpoint.indexOf(':') + 1 : -1;
	var endPos = endpoint.indexOf('@');
	var phoneNumber = (startPos > 0 && endPos > 0) ? endpoint.substring(startPos, endPos) : null;
	return phoneNumber;
};

module.exports.handleVoice = function(req, res) {
	// handle an incoming call and return twiml to forward it
	var phoneNumbers = utils.stringArray(req.params.phone);
	var twiml = new twilio.TwimlResponse();
	if (req.params.Direction === 'inbound') {
		twiml.dial({
			callerId: req.params.From,
			action: env.webtask_container + '/twilio-voice/voicemail?email=' + encodeURIComponent(req.params.email),
			timeout: 18,
		}, function(dial) {
			for (var i=0; i<phoneNumbers.length; i++) {
				dial.number(phoneNumbers[i]);
			}
		});
	} else {
		logger.warn('invalid call direction', req.params.Direction);
	}
	res.writeHead(200, { 'Content-Type': 'text/xml' });
	res.write(twiml.toString());
};

var echo = function(twiml) {
	// generate a url callback for static twiml
	return 'https://twimlets.com/echo?Twiml=' + encodeURIComponent(twiml.toString());
};

module.exports.handleVoicemail = function(req, res) {
	var twiml = new twilio.TwimlResponse();
	if (req.params.Direction === 'inbound' && req.params.DialCallStatus === 'no-answer') {
		// handle an incoming call that was not answered and generate twiml to capture voicemail
		var record = {
			action: echo(new twilio.TwimlResponse().hangup()),
			maxLength: 60,
			transcribe: true,
			transcribeCallback: env.webtask_container + '/twilio-voice/voicemail?email=' + encodeURIComponent(req.params.email),
			//recordingStatusCallback: env.webtask_container + '/twilio-voice/voicemail?email=' + encodeURIComponent(req.params.email),
		};
		twiml.gather({
			numDigits: 1,
			timeout: 0,
			action: echo(new twilio.TwimlResponse().record(record)),
		}, function(gather) {
			//gather.say({ voice: 'alice'}, 'Please leave a message')
			gather.play({}, env.voicemail_location)
		})
		.record(record);
	} else if (req.params.RecordingStatus === 'completed' || req.params.TranscriptionStatus === 'completed') {
		// handle a voicemail recording that has been captured (and optionally transcribed) and send via email
		auth.getOrCreateUser(req.params.email)
		.then(function(user) {
			// watson transcription
			return transcribeWatson(req.params.RecordingUrl)
			.then(function(watson) {
				var transcription = req.params.TranscriptionText ? req.params.TranscriptionText.replace(/ \n\n/g, '..') : '';
				logger.info('twilio', transcription);
				logger.info('watson', watson);
				// format phone number
				return tryFormat(user, req.params.From)
				// generate email
				.then(function(formattedPhone) {
					var hasAuth = auth.hasTwilioAuth(user);
					var dialerUrl = email.generateDialerUrl(user.email, req.params.To, req.params.From);
					var params = {
						twilio: transcription,
						watson: watson,
						formattedPhone: formattedPhone,
						hasAuth: hasAuth,
						recordingUrl: req.params.RecordingUrl,
						dialerUrl: dialerUrl,
					};
					return email.generateHeaders({
						from: req.params.From,
						to: req.params.To,
						email: user.email,
						hasAuth: hasAuth,
						formattedPhone: formattedPhone,
						subject: 'Voicemail from ' + formattedPhone,
						html: pug.render(views.voicemail, params),
						text: pug.render(views.voicemailPlain, params),
					});
				})
				// send email
				.then(email.sendGmail);
			});
		})
		.catch(function(err) {
			logger.error('failed to email voicemail', err);
		});
	}
	res.writeHead(200, { 'Content-Type': 'text/xml' });
	res.write(twiml.toString());
};

module.exports.handleSip = function(req, res) {
	// handle an incoming sip request and generate twiml to dial a phone
	var twiml = new twilio.TwimlResponse();
	if (req.params.Direction === 'inbound') {
		var from = parseSipEndpoint(req.params.From);
		var to = parseSipEndpoint(req.params.To);
		if (from && to) {
			twiml.dial(to, {
				callerId: from,
			});
		} else {
			logger.error('invalid endpoints: ' + req.params.From + ', ' + req.params.To);
		}
	} else {
		logger.warn('invalid call direction', req.params.Direction);
	}
	res.writeHead(200, { 'Content-Type': 'text/xml' });
	res.write(twiml.toString());
};

