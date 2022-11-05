#!/bin/sh

set -ex

tag=$(git tag --points-at HEAD)

if [ -z "$tag" ]; then
  tag='latest'
fi

BUILDER=mybuilder
docker buildx create --bootstrap --name $BUILDER --platform $PLATFORM --use

path=$(dirname $DOCKERFILE)
ext=${path##*/}
image="ghcr.io/$GITHUB_REPOSITORY/$ext"

docker buildx build \
  --builder $BUILDER \
  --push \
  --platform $PLATFORM \
  -t $image:$tag \
  -f $DOCKERFILE .
docker buildx imagetools inspect $image:$tag
