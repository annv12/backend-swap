#!/usr/bin/env bash

# go to current directory
cd `dirname $0`

# build Docker image
today=`date +%Y%m%d-%H%M%S`
current_tag_seq=`date +%Y%m%d`
next_tag_seq=$(expr $current_tag_seq + 1)
tag="${today}"
if [ $next_tag_seq -gt 1 ] ; then
    tag="${tag}-${next_tag_seq}"
fi
echo "tag is ${tag}"
case "${ENV}" in
  "prd" | "production" ) BUILD_ENV=prd ;;
  "stg" | "staging" ) BUILD_ENV=stg ;;
  * ) BUILD_ENV=dev ;;
esac


echo -n "${tag}" > version
docker compose down 
sed -ri '' "s/backend-api:.*$/backend-api:${tag}/g" docker-compose.yml
docker compose up -d
