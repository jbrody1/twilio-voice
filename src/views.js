'use strict';
module.exports.sms = '' +
'html\n' +
'	p\n' +
'		each line in text.split(\'\\n\')\n' +
'			= line\n' +
'			br\n' +
'\n' +
'	p\n' +
'		| --\n' +
'		br\n' +
'		| Sent using Splay voice-to-email. \n' +
'		- if (hasAuth)\n' +
'			| Reply to text the sender back.\n' +
'			br\n' +
'			a(href=dialerUrl) Return Call\n' +
'		- else\n' +
'			| To enable replies, \n' +
'			a(href=loginUrl) login\n' +
'			| .\n' +
'\n' +
'';
module.exports.smsPlain = '' +
'= text + \'\\n\\n\'\n' +
'| --\n' +
'= \'\\n\'\n' +
'| Sent using Splay voice-to-email. \n' +
'- if (hasAuth)\n' +
'	| Reply to text the sender back.\n' +
'	= \'\\nReturn Call: \' + dialerUrl\n' +
'- else\n' +
'	= \'To enable replies, login here: \' + loginUrl\n' +
'';
module.exports.voicemail = '' +
'html\n' +
'	p\n' +
'		| Twilio:\n' +
'		br\n' +
'		= twilio\n' +
'\n' +
'	p\n' +
'		| Watson:\n' +
'		br\n' +
'		= watson\n' +
'\n' +
'	audio(controls="controls")\n' +
'		source(src=recordingUrl)\n' +
'		a(href=recordingUrl) Play Audio\n' +
'\n' +
'	p\n' +
'		| --\n' +
'		br\n' +
'		| Sent using Splay voice-to-email. \n' +
'		- if (hasAuth)\n' +
'			| Reply to text the sender back.\n' +
'			br\n' +
'			a(href=dialerUrl) Return Call\n' +
'		- else\n' +
'			| To enable replies, \n' +
'			a(href=loginUrl) login\n' +
'			| .\n' +
'\n' +
'';
module.exports.voicemailPlain = '' +
'| Twilio:\n' +
'= \'\\n\' + twilio + \'\\n\\n\'\n' +
'| Watson:\n' +
'= \'\\n\' + watson + \'\\n\\n\'\n' +
'= \'Download Audio: \' + recordingUrl + \'\\n\'\n' +
'| --\n' +
'= \'\\n\'\n' +
'| Sent using Splay voice-to-email. \n' +
'- if (hasAuth)\n' +
'	| Reply to text the sender back.\n' +
'	= \'\\nReturn Call: \' + dialerUrl\n' +
'- else\n' +
'	= \'To enable replies, login here: \' + loginUrl\n' +
'';
