#!/bin/bash

if [ ! -f "env.properties" ]; then
  echo "ERROR: env.properties does not exist"
  exit 1
fi

npm install

. env.properties

if [ -z "${webtask_container}" ] || \
   [ -z "${sentry_yrl}" ] || \
   [ -z "${dialer_location}" ] || \
   [ -z "${voicemail_location}" ] || \
   [ -z "${watson_stt_username}" ] || \
   [ -z "${watson_stt_password}" ]
   [ -z "${twilio_account_sid}" ] || \
   [ -z "${twilio_auth_token}" ] || \
   [ -z "${google_id}" ] || \
   [ -z "${google_refresh_token}" ] || \
   [ -z "${google_project_id}" ] || \
   [ -z "${google_client_id}" ] || \
   [ -z "${google_client_secret}" ] || \
   [ -z "${google_cloud_json}" ]
then
  echo "ERROR: all environment properties must be defined"
  exit 1
fi

echo "Loaded env.properties"

cat > src/env.js <<EOL
'use strict';
module.exports.webtask_container = '${webtask_container}';
module.exports.sentry_url = '${sentry_url}';
module.exports.dialer_location = '${dialer_location}';
module.exports.voicemail_location = '${voicemail_location}';
module.exports.watson_stt_username = '${watson_stt_username}';
module.exports.watson_stt_password = '${watson_stt_password}';
module.exports.twilio_account_sid = '${twilio_account_sid}';
module.exports.twilio_auth_token = '${twilio_auth_token}';
module.exports.google_id = '${google_id}';
module.exports.google_refresh_token = '${google_refresh_token}';
module.exports.google_project_id = '${google_project_id}';
module.exports.google_client_id = '${google_client_id}';
module.exports.google_client_secret = '${google_client_secret}';
module.exports.google_cloud_json = '${google_cloud_json}';

EOL

echo "Wrote src/env.js"

cat > src/views.js <<EOL
'use strict';
EOL

for file in views/*.pug; do
name=${file}
name=${name#views/}
name=${name%.pug}
# escape \, escape ', insert leading ', append trailing \n' +
cat >> src/views.js <<EOL
module.exports.${name} = '' +
`cat ${file} | sed -e 's/\\\\/\\\\\\\\/g' | sed -e 's/'\''/\\\\'\''/g' | sed -e 's/^/'\''/g' | sed -e 's/$/\\\\n'\'' \\+/g'`
'';
EOL
done

echo "Wrote src/views.js"

#wt create --bundle src/webtask.js -n twilio-voice-stage
#wt create --bundle src/webtask.js -n twilio-voice

#wt create src/google-verification.js -n google19fff256032e0baf.html

wt-bundle -m -o build/webtask.js src/webtask.js
wt create build/webtask.js -n twilio-voice-stage
wt create build/webtask.js -n twilio-voice

