'use strict';

import { render } from 'preact';

import { Device, FunctionGenerator, SerialPortDevice } from './device';
import { AppState } from './state';
import { ConnectView, AppView } from './view';

const main = () => {
  const appElt = document.getElementById("app") as HTMLDivElement;
  const serial = navigator.serial;
  const state = new AppState();

  const choose = async () => {
    try {
      const port = await serial.requestPort();
      const info = port.getInfo();
      console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);

      const device = new SerialPortDevice(port, state);
      startApp(state, device, appElt);
    } catch (e) {
      console.log(e);
    }
  }

  const generate = () => {
    const device = new FunctionGenerator(state);
    startApp(state, device, appElt);

  }

  render(ConnectView({ haveSerial: Boolean(serial), onClickSerial: choose, onClickGenerator: generate }), appElt);
}

const startApp = (state: AppState, device: Device, appElt: Element): void => {
  let savesRequested = 0;
  let savesRendered = 0;
  let rendering = false;

  const onRender = () => {
    if (savesRequested == savesRendered) {
      rendering = false;
      return; // caught up
    }
    render(AppView(state.props), appElt);
    savesRendered = savesRequested;
    requestAnimationFrame(onRender); // will run in next frame
  }

  const onSave = () => {
    savesRequested++;
    if (!rendering) {
      rendering = true;
      requestAnimationFrame(onRender);
    }
  };

  state.addEventListener("save", onSave);

  const connectUnlessCancelled = async () => {
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));

    if (state.status == "connecting") {
      device.start();
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
        device.stop();
        break;
    }
  });

  let timeoutID = null as number;
  window.addEventListener("resize", function () {
    window.clearTimeout(timeoutID);
    timeoutID = window.setTimeout(() => { state.windowChanged() }, 250);
  })

  state.requestChange("connecting");
}

main();
