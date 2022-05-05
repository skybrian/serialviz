'use strict';

import { h, render, Component, ComponentChildren, toChildArray, createRef } from 'preact';
import { Terminal } from 'xterm';
import { decodeStream, findLines, Row, parseRow } from './csv';

class Start extends Component<{ onConnect: (port: SerialPort) => void }, { choosing: boolean }> {
  state = { choosing: false }

  choosePort = async () => {
    this.setState({ choosing: true });

    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      this.setState({ choosing: false });
      throw e;
    }

    const info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);
    this.props.onConnect(port);
  }

  render() {
    return <button id="connect" onClick={this.choosePort} disabled={this.state.choosing} class="pure-button pure-button-primary">Connect</button>;
  }
}

type PortStatus = "connecting" | "reading" | "closing" | "closed" | "portGone";

interface PortState {
  status: PortStatus;
  chunks: (Uint8Array | string)[];
  chunksRead: number;
}

const lineBufferSize = 40;

class App {

  port: SerialPort;
  appElt: Element;

  status = "connecting" as PortStatus;
  chunks = [] as (Uint8Array | string)[];
  chunksAdded = 0;
  chunkReader = null as ReadableStreamDefaultReader<Uint8Array>;

  rows = [] as Row[];
  rowsAdded = 0;
  rowReader = null as ReadableStreamDefaultReader<Uint8Array>;

  constructor(port: SerialPort, appElt: Element) {
    this.port = port;
    this.appElt = appElt;

    // Automatically close the serial port when another tab opens.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key == "openingSerialPort") {
        if (this.chunkReader != null) {
          this.chunkReader.cancel();
        }
      }
    });
    this.renderView();
    this.openPort();
  }

  renderView() {
    const state = { status: this.status, chunks: this.chunks, chunksRead: this.chunksAdded };
    const linesToTrim = this.rows.length - lineBufferSize;
    if (linesToTrim > 0) {
      this.rows = this.rows.slice(linesToTrim);
    }
    render(<PortView state={state} lines={this.rows} stop={this.stop} restart={this.restart} finishedChunks={this.finishedChunks} />, this.appElt);
  }

  renderChunk(chunk: Uint8Array | string) {
    this.chunks = this.chunks.concat([chunk]);
    this.chunksAdded += 1;
    this.renderView();
  }

  renderMessage(message: string) {
    this.renderChunk(`\r\n*** ${message} ***\r\n`);
  }

  renderStatus(status: PortStatus, options = {} as { message: string }) {
    this.status = status;
    if (options.message) {
      this.renderMessage(options.message);
    } else {
      this.renderView();
    }
  }

  renderFatal(message: any) {
    this.renderStatus("portGone", { message: message + "" });
  }

  openPort = async () => {
    if (this.status != "connecting") return;
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this.status != "connecting") return;

    try {
      await this.port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      const [chunkStream, lineStream] = this.port.readable.tee();
      this.chunkReader = chunkStream.getReader();
      this.rowReader = lineStream.getReader();

      this.renderStatus("reading");
    } catch (e) {
      this.renderFatal(e);
      return;
    }
    this.copyToTerminal();
    this.parseLines();
  }

  copyToTerminal = async () => {
    try {
      while (true) {
        const { value, done } = await this.chunkReader.read();
        if (done) {
          return;
        }
        this.renderChunk(value);
      }
    } catch (e) {
      this.renderFatal(e);
    } finally {
      this.chunkReader.releaseLock();
      this.chunkReader = null;
      this.closePort();
    }
  }

  parseLines = async () => {
    try {
      for await (let line of findLines(decodeStream(this.rowReader))) {
        const row = parseRow(this.rowsAdded, line);
        if (row) {
          this.rows.push(row);
        }
        this.rowsAdded++;
      }
    } finally {
      this.rowReader.releaseLock();
      this.rowReader = null;
    }
  }

  async closePort() {
    const tasks = [] as Promise<any>[];
    if (this.rowReader != null) {
      tasks.push(this.rowReader.cancel());
      this.rowReader = null;
    }
    if (this.chunkReader != null) {
      tasks.push(this.chunkReader.cancel());
      this.chunkReader = null;
    }
    for (let task of tasks) {
      try {
        await task;
      } catch (e) {
        this.renderFatal(e);
      }
    }
    try {
      await this.port.close();
      if (this.status != "portGone") {
        this.renderStatus("closed", { message: "Closed" });
      }
    } catch (e) {
      this.renderFatal(e);
    }
  }

  stop = () => {
    if (this.status == "reading") {
      this.renderStatus("closing");
      this.closePort();
    }
  }

  restart = () => {
    if (this.status == "closed") {
      this.chunks = [];
      this.chunksAdded = 0;
      this.rows = [];
      this.rowsAdded = 0;
      this.renderStatus("connecting");
      this.openPort();
    }
  }

  finishedChunks = (done: number) => {
    const todo = this.chunksAdded - done;
    if (todo == this.chunks.length) return; // no change
    if (todo == 0) {
      this.chunks = [];
    } else {
      this.chunks = this.chunks.slice(-todo);
    }
  }
}

const PortView = (props: { state: PortState, lines: Row[], stop: () => void, restart: () => void, finishedChunks: (n: number) => void }) => {

  const button = () => {
    switch (props.state.status) {
      case "reading":
        return <button onClick={props.stop} class="pure-button pure-button-primary">Stop</button>;
      case "closed":
        return <button onClick={props.restart} class="pure-button pure-button-primary">Restart</button>;
      default:
        return <button disabled={true} class="pure-button">Stop</button>;
    }
  }
  return <div class="port-view">
    <div>
      {button()}
    </div>
    <TabView labels={["Log", "Table"]}>
      <TermView chunks={props.state.chunks} chunksRead={props.state.chunksRead} finishedChunks={props.finishedChunks} />
      <TableView rows={props.lines} />
    </TabView>
  </div>;
}

interface TabProps {
  labels: string[];
  children: ComponentChildren;
}

class TabView extends Component<TabProps, { selected: number }> {
  state = { selected: 0 }

  tabClicked(choice: number) {
    this.setState({ selected: choice });
  }

  render() {
    const selected = this.state.selected;
    const labels = this.props.labels;
    const children = toChildArray(this.props.children);
    return <div class="tab-view">
      <div class="pure-menu pure-menu-horizontal"><ul class="pure-menu-list">
        {labels.map((label, i) =>
          <li class='pure-menu-item {i==selected ? "pure-menu-selected" : ""}'>
            <a href="#" class="pure-menu-link" onClick={() => this.tabClicked(i)}>{label}</a>
          </li>)}
      </ul></div>
      <div>
        {children.map((child, i) => <div class={i == selected ? "tab-view-selected-child" : "tab-view-unselected-child"}>{child}</div>)}
      </div>
    </div>
  }
}

class TermView extends Component<{ chunks: (Uint8Array | string)[], chunksRead: number, finishedChunks: (n: number) => void }, {}> {
  terminal = new Terminal({
    rows: 50,
    scrollback: 0,
  });
  chunksWritten = 0;

  terminalElt = createRef();

  reader = null as ReadableStreamDefaultReader<Uint8Array>;

  componentDidMount() {
    this.terminal.open(this.terminalElt.current);
    this.componentDidUpdate();
  }

  componentDidUpdate() {
    const sent = this.props.chunksRead;
    if (sent == 0) {
      if (this.chunksWritten > 0) {
        this.terminal.clear();
        this.chunksWritten = 0;
      }
      return;
    }

    const chunks = this.props.chunks;
    const start = this.chunksWritten;
    for (let todo = sent - this.chunksWritten; todo > 0; todo--) {
      this.terminal.write(chunks[chunks.length - todo]);
      this.chunksWritten++;
    }
    if (this.chunksWritten - start > 0) {
      this.props.finishedChunks(this.chunksWritten);
    }
  }

  render() {
    return <div id="terminal" ref={this.terminalElt}></div>
  }
}

function TableView(props: { rows: Row[] }) {
  return <table>
    {props.rows.map((row) => <RowView {...row} />)}
  </table>
}

function RowView(props: Row) {
  return <tr>
    {props.fields.map((val) => <td>{val}</td>)}
  </tr>
}

function main() {
  const appElt = document.getElementById("app") as HTMLDivElement;
  render(<Start onConnect={(port) => new App(port, appElt)} />, appElt);
}

main();
