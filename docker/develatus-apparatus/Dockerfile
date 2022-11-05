FROM node:lts-alpine
COPY . /tmp/app
RUN cd /tmp/app && yarn global add file://$(pwd) && rm -rf /tmp/app
ENTRYPOINT ["/usr/local/bin/develatus-apparatus"]
