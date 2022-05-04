'use strict';

import { h, render, Component, createRef } from 'preact';
import { Terminal } from 'xterm';

class Start extends Component<{onConnect: (port: SerialPort) => void}, {choosing: boolean}> {
  state = { choosing: false }

  choosePort = async () => {
    this.setState({choosing: true});

    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      this.setState({choosing: false});
      throw e;
    }

    const info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);
    this.props.onConnect(port);
  }

  render() {
    return <button id="connect" onClick={this.choosePort} disabled={this.state.choosing}>Connect</button>;
  }
}

class LogView extends Component<{defaultPort: SerialPort}, {stopped: boolean, disabled: boolean}> {
  port = this.props.defaultPort; // ignore any changes

  state = { stopped: false, disabled: false }

  copyDone = Promise.resolve();

  terminal = new Terminal({
    rows: 50,
    scrollback: 0,
  });

  terminalElt = createRef();

  componentDidMount() {
    // Automatically close the serial port when another tab opens.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key == "openingSerialPort") {
        this.setState({stopped: true});
      }
    });
    this.terminal.open(this.terminalElt.current);
    this.copyDone = this.copyToTerminal();
  }

  componentDidUpdate(prevProps, prevState) {
    if (!this.state.stopped && prevState.stopped) {
      this.copyDone.then(() => {
        this.copyDone = this.copyToTerminal()
      });
    }
  }

  onStop = () => {
    this.setState((state) => ({stopped: !state.stopped}));
  }

  writeStatus(e: any) {
    this.terminal.write(`\n*** ${e} ***\r\n\r\n`);
  }

  fatal(e: any) {
    this.writeStatus(e);
    this.setState({disabled: true});
  }

  copyToTerminal = async (): Promise<void> => {
    try {
      await this.doCopyToTerminal();
    } catch (e) {
      this.fatal(e);
    }
  }

  doCopyToTerminal = async (): Promise<void> => {
    if (this.state.stopped) return;

    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this.state.stopped) return;

    this.terminal.clear();

    await this.port.open({
      baudRate: 115200,
      bufferSize: 40,
      flowControl: "hardware",
    });

    try {
      if (this.state.stopped) return;

      const reader = this.port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          this.terminal.write(value);
          if (this.state.stopped || done) {
            return;
          }
        }
      } finally {
        reader.releaseLock();
      }

    } finally {
      await this.port.close();
      this.writeStatus("Closed Port");
    }
  }

  render() {
    return <div>
      <div>
        <button id="stop" onClick={this.onStop} disabled={this.state.disabled}>{this.state.stopped ? "Reconnect" : "Stop"}</button>
      </div>
      <div id="terminal" ref={this.terminalElt}></div>
    </div>;
  }
}

const appElt = document.getElementById("app") as HTMLDivElement;

function showLog(port: SerialPort) {
  render(<LogView defaultPort={port}/>, appElt);
}

render(<Start onConnect={showLog}/>, appElt);
