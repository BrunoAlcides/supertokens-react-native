# get driver version
version=`cat ../package.json | grep -e '"version":'`
while IFS='"' read -ra ADDR; do
    counter=0
    for i in "${ADDR[@]}"; do
        if [ $counter == 3 ]
        then
            version=$i
        fi
        counter=$(($counter+1))
    done
done <<< "$version"

# replace path version with X
IFS='.' read -r -a array <<< "$version"
versionFolder="${array[0]}"."${array[1]}".X

# create react-native docs dir in repo if not exists
(cd ../../supertokens-backend-website && mkdir -p ./app/docs/sdk/docs/react-native/${versionFolder})

# copy docs content from this repo to the supertokens-backend-website repo
cp -r ../docs/* ../../supertokens-backend-website/app/docs/sdk/docs/react-native/
cp -r ../docs/* ../../supertokens-backend-website/app/docs/sdk/docs/react-native/${versionFolder}

# push to git
git config --global user.email "$EMAIL"
git config --global user.name "$NAME"
(cd ../../supertokens-backend-website && git add --all && git commit -m"updates react-native docs" && git pull && git push && ./releaseDev.sh)