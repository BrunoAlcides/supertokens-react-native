version=$(cat ../package.json | jq .version | tr -d '"')
isLatest=`curl -s -X GET \
"https://api.supertokens.io/0/frontend/latest/check?password=$SUPERTOKENS_API_KEY&version=$version&name=react-native" \
-H 'api-version: 0'`
if [[ $? -ne 0 ]]
then
    echo "api not working... exiting!"
    exit 1
fi
if [[ `echo $isLatest | jq .isLatest` == "true" ]]
then
    cd ..
    npm publish --tag latest
else
    cd ..
    npm publish --tag version-$version
fi