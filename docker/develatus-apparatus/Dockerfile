FROM node:lts-alpine@sha256:1f09c210a17508d34277971b19541a47a26dc5a641dedc03bd28cff095052996
COPY . /tmp/app
RUN cd /tmp/app && yarn global add file://$(pwd) && rm -rf /tmp/app
ENTRYPOINT ["/usr/local/bin/develatus-apparatus"]
