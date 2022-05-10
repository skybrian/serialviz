'use strict';

import { render } from 'preact';

import { SerialPortDevice } from './device';
import { AppState } from './state';
import { ConnectView, AppView } from './view';

const choosePort = (elt: Element): Promise<SerialPort> => {
  return new Promise((resolve) => {

    const serial = navigator.serial;

    const choose = async () => {
      try {
        const port = await serial.requestPort();
        const info = port.getInfo();
        console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);
        resolve(port);
      } catch (e) {
        console.log(e);
      }
    }

    render(ConnectView({ haveSerial: Boolean(serial), onClick: choose }), elt);
  });
}


const main = async () => {
  const appElt = document.getElementById("app") as HTMLDivElement;

  const port = await choosePort(appElt);

  const state = new AppState();

  state.addEventListener("save", () => render(AppView(state.props), appElt));

  const task = new SerialPortDevice(port, state);

  const connectUnlessCancelled = async () => {
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));

    if (state.status == "connecting") {
      task.connect();
    } else {
      console.log("connect cancelled");
    }
  }

  // Automatically close the serial port when another tab opens.
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key == "openingSerialPort") {
      state.requestClose();
    }
  });

  state.addEventListener("status", () => {
    switch (state.status) {
      case "connecting":
        connectUnlessCancelled();
        break;
      case "closing":
        task.cancel();
        break;
    }
  });

  let timeoutID = null as number;
  window.addEventListener("resize", function() {
    window.clearTimeout(timeoutID);
    timeoutID = window.setTimeout(() => { state.windowChanged() }, 250);
  })

  state.requestChange("connecting");
}

main();
