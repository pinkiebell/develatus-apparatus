#!/bin/sh

set -ex

tag=$(git tag --points-at HEAD)

if [ -z "$tag" ]; then
  tag='latest'
fi

BUILDER=mybuilder
docker buildx create --bootstrap --name $BUILDER --platform $PLATFORM --use || echo 'skip'
docker buildx inspect

path=$(dirname $DOCKERFILE)
ext=${path##*/}
image="ghcr.io/$GITHUB_REPOSITORY/$ext"

docker buildx build \
  --builder $BUILDER \
  --cache-from "type=local,src=$RUNNER_TEMP/docker-cache" \
  --cache-to "type=local,dest=$RUNNER_TEMP/docker-cache-new" \
  --push \
  --platform $PLATFORM \
  -t $image:$tag \
  -f $DOCKERFILE .
docker buildx imagetools inspect $image:$tag
