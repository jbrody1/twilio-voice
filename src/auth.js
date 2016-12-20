'use strict';
var env = require('./env');
var utils = require('./utils');
var logger = utils.logger;
var uuid = require('uuid');
// hack for webtask: including auth0 module without explicit version fails
var auth0 = function() {
	try { return require('auth0@2.4.0'); }
	catch (err) { return require('auth0'); }
}();
var mgr = new auth0.ManagementClient({
	token: env.auth0_token,
	domain: env.auth0_domain,
});

module.exports.getOrCreateUser = function(email, accountSid) {
	// normalize email
	email = email.toLowerCase();
	// try to fetch user
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
			// retrieve
			return user;
		}
	});
};

module.exports.hasTwilioAuth = function(user) {
	// does the user have twilio credentials
	return  user &&
		user.app_metadata &&
		user.app_metadata.twilio_account_sid &&
		user.app_metadata.twilio_auth_token;
};

