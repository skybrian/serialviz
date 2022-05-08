'use strict';

import { h, render, Component, ComponentChildren, toChildArray, createRef } from 'preact';
import { decodeStream, findLines, Row, parseRow, TableBuffer, Table } from './csv';
import { Terminal } from 'xterm';
import * as Plot from "@observablehq/plot";
import { PortState, Log, AppState } from './state';

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
    return <div>
      <button id="connect" onClick={this.choosePort} disabled={this.state.choosing} class="pure-button pure-button-primary">Connect</button>
    </div>;
  }
}

const lineBufferSize = 500;

class App {

  port: SerialPort;
  appElt: Element;

  state = new AppState();

  rowsSeen = 0;
  rows = new TableBuffer(lineBufferSize);

  readers = [] as ReadableStreamGenericReader[];
  tasks = [] as Promise<any>[];

  constructor(port: SerialPort, appElt: Element) {
    this.port = port;
    this.appElt = appElt;

    // Automatically close the serial port when another tab opens.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key == "openingSerialPort") {
        this.requestClose();
      }
    });
    this.renderView();
    this.openPort();

    this.state.addEventListener("save", () => {
      this.renderView();
    });
  }

  renderView() {
    render(<PortView state={this.state.portState} table={this.rows.table} stop={this.requestClose} restart={this.requestRestart} />, this.appElt);
  }

  openPort = async () => {
    if (this.state.status != "connecting") return;
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this.state.status != "connecting") return;

    try {
      await this.port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      if (this.state.requestPortChange("reading")) {
        const [chunkStream, lineStream] = this.port.readable.tee();
        this.tasks.push(this.copyToTerminal(chunkStream));
        this.tasks.push(this.parseRows(lineStream));
      }
      this.closePortWhenDone();
    } catch (e) {
      this.state.fatal(e);
      return;
    }
  }

  copyToTerminal = async (stream: ReadableStream) => {
    const reader = stream.getReader();
    this.readers.push(reader);
    try {
      for await (let line of findLines(decodeStream(reader))) {
        this.state.pushLog(line);
      }
    } finally {
      reader.releaseLock();
      await stream.cancel();
    }
  }

  parseRows = async (stream: ReadableStream) => {
    try {
      const reader = stream.getReader();
      this.readers.push(reader);

      for await (let line of findLines(decodeStream(reader))) {
        const row = parseRow(line);
        if (row) {
          this.rows.push(row);
        }
        this.rowsSeen++;
      }
    } finally {
      await stream.cancel();
    }
  }

  async closePortWhenDone() {
    for (let task = this.tasks.shift(); task; task = this.tasks.shift()) {
      try {
        await task;
      } catch (e) {
        this.state.fatal(e);
      }
    }

    try {
      await this.port.close();
      this.state.requestPortChange("closed", { message: "Closed" });
    } catch (e) {
      this.state.fatal(e);
    }
  }

  requestClose = (): boolean => {
    if (this.state.requestPortChange("closed", { optional: true })) {
      return true;
    } else if (this.state.requestPortChange("closing")) {
      for (let reader of this.readers) {
        this.tasks.push(reader.cancel());
      }
      this.readers = [];
      return true;
    } else {
      return false;
    }
  }

  requestRestart = (): boolean => {
    if (!this.state.requestPortChange("connecting")) return false;
    this.rowsSeen = 0;
    this.rows.clear();
    this.openPort();
  }
}

const PortView = (props: { state: PortState, table: Table, stop: () => void, restart: () => void }) => {

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

  const table = props.table;

  return <div class="port-view">
    <div>
      {button()}
    </div>
    <TabView labels={["Log", "Plot"]}>
      <TermView log={props.state.log} />
      {table == null ? "" : <PlotView {...table} />}
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
          <li class={i == selected ? "pure-menu-item pure-menu-selected" : "pure-menu-item"}>
            <a href="#" class="pure-menu-link" onClick={() => this.tabClicked(i)}>{label}</a>
          </li>)}
      </ul></div>
      {children.map((child, i) => {
        if (i == selected) {
          return <div class="tab-view-selected">{child}</div>
        }
      })}
    </div>
  }
}

class TermView extends Component<{ log: Log }> {
  terminal = new Terminal({
    rows: 50,
    scrollback: 0,
  });
  currentLog = 0;
  lastLineSeen = -1;

  terminalElt = createRef();

  componentDidMount() {
    this.terminal.open(this.terminalElt.current);
    this.componentDidUpdate();
  }

  componentDidUpdate() {
    const log = this.props.log;
    if (this.currentLog != log.key) {
      this.terminal.clear();
      this.currentLog = log.key;
      this.lastLineSeen = -1;
    }
    for (let line of log.lines) {
      if (line.key > this.lastLineSeen) {
        this.terminal.writeln(line.value);
        this.lastLineSeen = line.key;
      }
    }
  }

  render() {
    return <div class="term-view" ref={this.terminalElt}></div>
  }
}

class PlotView extends Component<Table> {
  plotElt = createRef<HTMLDivElement>();
  lastIndex = null;

  plot(parent: HTMLDivElement) {
    parent.textContent = "";

    let width = parent.offsetWidth;
    width = !width ? 640 : width;

    let height = parent.offsetHeight - 50;

    const columnNames = this.props.columnNames;
    const cols = this.props.columns;
    const rowsScrolled = this.props.rowsRemoved;
    this.lastIndex = this.props.indexes.at(-1);

    let marks = [];
    if (this.props.rowCount >= 2) { // avoid high cardinality warning in Plot.
      for (let i = 0; i < columnNames.length; i++) {
        marks.push(Plot.lineY(cols[i], { x: this.props.indexes, stroke: i }));
      }
    }

    parent.appendChild(Plot.plot({
      width: width,
      height: height,
      marks: marks,
      x: {
        domain: [rowsScrolled, rowsScrolled + lineBufferSize]
      },
      y: {
        nice: true
      },
      color: {
        type: "categorical",
        legend: true,
        tickFormat: i => columnNames[i],
      }
    }));
  }

  componentDidMount() {
    this.plot(this.plotElt.current);
  }

  shouldComponentUpdate(nextProps: Table): boolean {
    return !document.hidden && this.lastIndex != nextProps.indexes.at(-1);
  }

  componentDidUpdate() {
    this.plot(this.plotElt.current);
  }

  render() {
    return <div ref={this.plotElt} class="plot-view" />
  }
}

function main() {
  const appElt = document.getElementById("app") as HTMLDivElement;
  render(<Start onConnect={(port) => new App(port, appElt)} />, appElt);
}

main();
