# serialviz

This is a web app that plots data read from a serial port. It's similar to the Arduino serial monitor and plotter, but with some UI improvements.

As of May 2022, it only works in Chromium based browsers, because others don't implement the
[Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) yet.

The serial device should log data in CSV format, with the restriction that multi-line values aren't allowed. (CSV normally allows newlines within quotes.)

Deployed at: https://serialviz.skybrian.com/
