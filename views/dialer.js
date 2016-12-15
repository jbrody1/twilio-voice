var hash = window.location.hash ? window.location.hash.substring(1) : null;
var params = URI('?' + hash).query(true);

Twilio.Device.ready(function (device) { console.log('ready'); });
Twilio.Device.error(function (error) { console.log('error', + error); });
Twilio.Device.connect(function (conn) { console.log('call started'); });
Twilio.Device.disconnect(function (conn) { console.log('call ended'); });
Twilio.Device.incoming(function (conn) { console.log('incoming connection', + conn); conn.accept(); });
Twilio.Device.setup(params.token);
function call() { Twilio.Device.connect({ From: params.from, To: params.to }); }
function hangup() { Twilio.Device.disconnectAll(); }

