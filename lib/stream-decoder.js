'use strict';
const kNoData = 1;
const kReadingSize = 2;
const kReadingMessage = 3;


class StreamDecoder {
  constructor () {
    this.readState = kNoData;
    this.readCompressFlag = Buffer.alloc(1);
    this.readPartialSize = Buffer.alloc(4);
    this.readSizeRemaining = 4;
    this.readMessageSize = 0;
    this.readMessageRemaining = 0;
    this.readPartialMessage = [];
  }

  write (data) {
    const result = [];
    let readHead = 0;
    let toRead;

    while (readHead < data.length) {
      switch (this.readState) {
        case kNoData :
          this.readCompressFlag = data.slice(readHead, readHead + 1);
          readHead += 1;
          this.readState = kReadingSize;
          this.readPartialSize.fill(0);
          this.readSizeRemaining = 4;
          this.readMessageSize = 0;
          this.readMessageRemaining = 0;
          this.readPartialMessage = [];
          break;
        case kReadingSize :
          toRead = Math.min(data.length - readHead, this.readSizeRemaining);
          data.copy(
            this.readPartialSize, 4 - this.readSizeRemaining, readHead,
            readHead + toRead);
          this.readSizeRemaining -= toRead;
          readHead += toRead;
          // readSizeRemaining >=0 here
          if (this.readSizeRemaining === 0) {
            this.readMessageSize = this.readPartialSize.readUInt32BE(0);
            this.readMessageRemaining = this.readMessageSize;
            if (this.readMessageRemaining > 0) {
              this.readState = kReadingMessage;
            } else {
              const message = Buffer.concat(
                [this.readCompressFlag, this.readPartialSize], 5);

              this.readState = kNoData;
              result.push(message);
            }
          }
          break;
        case kReadingMessage :
          toRead =
              Math.min(data.length - readHead, this.readMessageRemaining);
          this.readPartialMessage.push(
            data.slice(readHead, readHead + toRead));
          this.readMessageRemaining -= toRead;
          readHead += toRead;
          // readMessageRemaining >=0 here
          if (this.readMessageRemaining === 0) {
            // At this point, we have read a full message
            const framedMessageBuffers = [
              this.readCompressFlag, this.readPartialSize
            ].concat(this.readPartialMessage);
            const framedMessage = Buffer.concat(
              framedMessageBuffers, this.readMessageSize + 5);

            this.readState = kNoData;
            result.push(framedMessage);
          }
          break;
        default :
          throw new Error('Unexpected read state');
      }
    }

    return result;
  }
}

module.exports = { StreamDecoder };
