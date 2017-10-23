'use strict';
var env = require('./env');
var utils = require('./utils');
var logger = utils.logger;
var auth = require('./auth');
var twilio = require('twilio');
var querystring = require('querystring');
var useragent = require('useragent');

module.exports.handleDialer = function(req, res) {
	// get user
	return auth.getOrCreateUser(req.params.email)
	.then(function(user) {
		var agent = useragent.lookup(req.headers['user-agent']);
		logger.debug('useragent', agent);
		var hasWebRTC = ['Chrome', 'Firefox', 'Edge'].some(function(sub){ return agent.family.indexOf(sub) >= 0; });
		var isMobile = ['Android', 'iOS'].some(function(sub){ return agent.os.family.indexOf(sub) >= 0; });
		var useVoip = auth.hasTwilioAuth(user) && hasWebRTC && !isMobile;
		if (useVoip) {
			// if using voip, redirect to the soft phone dialer page
			var capability = new twilio.Capability(user.twilio_account_sid, user.twilio_auth_token);
			capability.allowClientOutgoing('AP8532d2cd0cbe2c84a7c9be698c9537c7');
			var token = capability.generate();
			var hash = '#' + querystring.stringify({
				from: req.params.from,
				to: req.params.to,
				token: token,
			});
			res.redirect(env.dialer_location + hash);
		} else {
			// otherwise, redirect to a phone dialer
			res.redirect('tel:' + req.params.to);
		}
	});
};

