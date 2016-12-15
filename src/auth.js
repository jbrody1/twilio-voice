'use strict';
var env = require('./env');
var utils = require('./utils');
var logger = utils.logger;
var uuid = require('uuid');
var auth0 = require('auth0@2.4.0');
//var auth0 = require('auth0');
var mgr = new auth0.ManagementClient({
	token: env.auth0_token,
	domain: env.auth0_domain,
});

module.exports.getOrCreateUser = function(email, accountSid) {
	email = email.toLowerCase();
	return mgr.users.getAll({
		q: 'email.raw:"' + email + '"',
		fields: 'user_id,email,app_metadata',
	}).then(function(users) {
		logger.debug('users', users);
		var user = users && users.length > 0 && users[0];
		if (!user) {
			// create
			user = {
				email: email,
				email_verified: false,
				connection: 'Username-Password-Authentication',
				password: uuid.v4(),
				app_metadata: {	twilio_account_sid: accountSid },
			};
			logger.info('creating user', user);
			return mgr.users.create(user);
		} else if (accountSid && (
				!user.app_metadata ||
				!user.app_metadata.twilio_account_sid ||
				user.app_metadata.twilio_account_sid !== accountSid)) {
			// update
			user.id = user.user_id;
			var update = {
				app_metadata: {
					twilio_account_sid: accountSid,
					twilio_auth_token: null,
				}
			};
			logger.info('updating user', update);
			return mgr.users.update(user, update);
		} else {
			return user;
		}
	});
};

module.exports.hasTwilioAuth = function(user) {
	return  user &&
		user.app_metadata &&
		user.app_metadata.twilio_account_sid &&
		user.app_metadata.twilio_auth_token;
};

