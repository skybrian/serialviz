'use strict';

import { h, Component, ComponentChildren, toChildArray, createRef, Fragment, VNode } from 'preact';
import { ColumnSlice, TableSlice } from './csv';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import * as Plot from "@observablehq/plot";
import { LogLine, PlotSettings, AppProps, SelectedTab } from './state';

interface ConnectProps {
  haveSerial: boolean;
  onClickSerial: () => void;
  onClickGenerator: () => void;
}

export const ConnectView = (props: ConnectProps) => {
  const noSerialMessage =
    <p>
      ⚠️ Sorry, you won't be able to connect to the serial port with this browser, because it doesn't support the Web Serial API.
      (See <a href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API#browser_compatibility">compatible browsers</a>.)
    </p>

  return <div class="connect-view">
    <div class="message-box">
      <p> This app plots CSV data from a device that logs to a serial port on your computer. Useful for Arduino.
        (More on <a href="https://github.com/skybrian/serialviz">GitHub.</a>)</p>
      {props.haveSerial ? "" : noSerialMessage}
    </div>
    <button disabled={!props.haveSerial}
      onClick={props.onClickSerial}
      class="pure-button pure-button-primary">Connect to Serial Port</button>
    <div class="message-box">
      <p>{props.haveSerial ? "Or if you don't have a serial device to connect to, you" : "You"} can still try out SerialViz using a fake device:</p>
    </div>
    <button onClick={props.onClickGenerator} class={"pure-button " + (props.haveSerial ? "" : "pure-button-primary")}>Start Function Generator</button>
  </div>;
}

export const AppView = (props: AppProps) => {

  const stopButton = () => {
    switch (props.state.status) {
      case "reading":
        return <button onClick={props.stop} class="pure-button pure-button-primary">Stop</button>;
      case "closed":
        return <button onClick={props.restart} class="pure-button pure-button-primary">Restart</button>;
      default:
        return <button disabled={true} class="pure-button">Stop</button>;
    }
  }

  const log = props.state.log;
  const table = props.table;
  const tabs = Object.values(SelectedTab);

  let zoom = <div></div>;
  if ( props.tab == SelectedTab.plot) {
    const zoomRange = props.plotSettings.zoomRange;
    zoom = <div class="zoom">
      Zoom <input
        type="range"
        disabled={zoomRange.length == 0}
        min={zoomRange.start} max={zoomRange.end}
        value={props.plotSettings.windowSize}
        onInput={(e) => props.zoom(Number(e.currentTarget.value))}/>
    </div>
  }

  return <div class="app-view">
    <div>
      {stopButton()}
    </div>
    <TabView labels={tabs} rightOfTabs={zoom} selected={props.tab} chooseTab={props.chooseTab}>
      <TermView logKey={log.key} lines={log.head} truncateRows windowChanges={props.windowChanges} />
      <TermView logKey={log.key} lines={log.tail} windowChanges={props.windowChanges} />
      {table == null ? "" : <PlotView
        table={table}
        settings={props.plotSettings}
        windowChanges={props.windowChanges}
        toggleColumn={props.toggleColumn} />}
    </TabView>
  </div>;
}

interface TabProps {
  labels: string[];
  rightOfTabs?: VNode;
  selected: string;
  chooseTab: (label: string) => void;
  children: ComponentChildren;
}

const TabView = (props: TabProps) => {
  const selected = props.selected;
  const labels = props.labels;
  const children = toChildArray(props.children);
  return <div class="tab-view">
    <div class="tab-row">
      <div class="pure-menu pure-menu-horizontal"><ul class="pure-menu-list">
        {labels.map((label) =>
          <li class={label == selected ? "pure-menu-item pure-menu-selected" : "pure-menu-item"}>
            <a href="#" class="pure-menu-link" onClick={() => props.chooseTab(label)}>{label}</a>
          </li>)}
      </ul>
      </div>
      {(props.rightOfTabs ? <div class="right-of-tabs">{props.rightOfTabs}</div> : "")}
    </div>
    {children.map((child, i) => {
      if (labels[i] == selected) {
        return <div class="tab-view-selected">{child}</div>
      }
    })}
  </div>
}

interface TermProps {
  logKey: number;
  lines: LogLine[];
  truncateRows?: boolean;
  windowChanges: number;
}

class TermView extends Component<TermProps> {
  terminal: Terminal;
  fitAddon: FitAddon;

  currentLog = 0;
  lastKeyWritten = -1;
  linesWritten = 0;
  lastWindowChangeSeen: number;

  terminalElt = createRef();

  componentDidMount() {
    this.terminal = new Terminal({
      scrollback: 0,
    });
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalElt.current);
    this.fitAddon.fit();
    this.componentDidUpdate();
  }

  shouldComponentUpdate(nextProps: TermProps): boolean {
    const nextKey = nextProps.lines.length == 0 ? -1 : nextProps.lines.at(-1).key;
    const thisKey = this.props.lines.length == 0 ? -1 : this.props.lines.at(-1).key;
    return (
      nextProps.logKey != this.props.logKey ||
      nextKey != thisKey ||
      nextProps.windowChanges != this.lastWindowChangeSeen
    );
  }

  componentDidUpdate() {
    const newDim = this.fitAddon.proposeDimensions();

    // Clear terminal if needed
    if (this.currentLog != this.props.logKey ||
      (this.props.truncateRows && newDim.rows != this.terminal.rows)) {
      this.terminal.clear();
      this.currentLog = this.props.logKey;
      this.lastKeyWritten = -1;
      this.linesWritten = 0;
    }

    // Resize terminal if needed
    if (this.props.windowChanges != this.lastWindowChangeSeen) {
      this.fitAddon.fit();
      this.lastWindowChangeSeen = this.props.windowChanges;
    }

    // Append lines if needed
    for (let line of this.props.lines) {
      if (this.props.truncateRows && this.linesWritten >= this.terminal.rows - 1) {
        break;
      }
      if (line.key > this.lastKeyWritten) {
        this.terminal.writeln(line.value);
        this.lastKeyWritten = line.key;
        this.linesWritten++;
      }
    }
  }

  render() {
    return <div class="term-view" ref={this.terminalElt}></div>
  }
}

// Colors generated by https://observablehq.com/@skybrian/serialviz-colors

// category10 (brighter)
const litColorRange = [
  "#258ed7",
  "#ff9811",
  "#35bf35",
  "#ff2f30",
  "#b17be2",
  "#a7675a",
  "#ff8ee8",
  "#989898",
  "#e1e229",
  "#1be3f7"
];

// category10 (darker)
const darkColorRange = [
  "#124669",
  "#7d4a08",
  "#1a5e1a",
  "#7d1718",
  "#573c6f",
  "#52322c",
  "#7d4672",
  "#4a4a4a",
  "#6e6f14",
  "#0d6f79"
];

const maxUnselectedViews = 4;

interface PlotProps {
  table: TableSlice;
  settings: PlotSettings;
  windowChanges: number;
  toggleColumn: (name: string) => void;
}

class PlotView extends Component<PlotProps> {
  plotElt = createRef<HTMLDivElement>();

  colorFor(columnName: string, options?: { lit?: boolean }): string {
    const lit = options?.lit ?? true;
    for (let i = 0; i < litColorRange.length; i++) {
      if (this.props.table.columnNames[i] == columnName) {
        return lit ? litColorRange.at(i) : darkColorRange.at(i);
      }
    }
    return "black";
  }

  get xDomain(): [number, number] {
    const windowSize = this.props.settings.windowSize;
    const r = this.props.table.range;
    const start = Math.max(0, r.end - windowSize);
    return [start, start + windowSize];
  }

  plot(parent: HTMLDivElement) {
    parent.textContent = "";

    let width = parent.offsetWidth;
    width = !width ? 640 : width;
    let height = parent.offsetHeight;

    const table = this.props.table;
    const rowsScrolled = this.xDomain[0];

    let marks = [];
    if (table.range.length >= 2) { // avoid high cardinality warning in Plot.
      for (let col of table.columns) {
        if (this.props.settings.columnStates.get(col.name) == "top") {
          const start = col.range.start;
          marks.push(Plot.lineY(col.values, { x: (_, i) => i + start, stroke: this.colorFor(col.name) }));
        }
      }
    }

    parent.appendChild(Plot.plot({
      width: width,
      height: height,
      marks: marks,
      x: {
        domain: this.xDomain,
        axis: "top"
      },
      y: {
        nice: true,
        zero: true
      }
    }));
  }

  componentDidMount() {
    this.plot(this.plotElt.current);
  }

  shouldComponentUpdate(next: PlotProps): boolean {
    return !document.hidden && !this.props.table.range.equals(next.table.range) ||
      this.props.windowChanges != next.windowChanges ||
      this.props.settings != next.settings;
  }

  componentDidUpdate() {
    this.plot(this.plotElt.current);
  }

  makeToggleButton = (name: string) => {
    const state = this.props.settings.columnStates.get(name);
    const classes = "swatch" + (state == "top" ? " swatch-lit" : (state == "bottom" ? " swatch-bottom" : ""));
    return <div class="swatch-button">
      <span class={classes} style={`background-color: ${this.colorFor(name, { lit: state != "hidden" })}`}> </span>
      <button class="pure-button"
        onClick={() => this.props.toggleColumn(name)}
      >{name}</button>
    </div>
  };

  bottomColumns(): ColumnSlice[] {
    const states = this.props.settings.columnStates;
    return this.props.table.columns.filter((c) => states.get(c.name) == "bottom");
  }

  render() {
    return <div class="plot-view">
      <div class="plot-main-buttons" role="group">
        {this.props.table.columnNames.map((name) => this.makeToggleButton(name))}
      </div>
      <div class="plot-main" ref={this.plotElt} />
      {this.bottomColumns().map((col) =>
        <BottomPlotView
          column={col}
          xDomain={this.xDomain}
          color={this.colorFor(col.name)}
        />)}
    </div>;
  }

  renderUnselectedColumn(name: string) {

    return <>
      <div class="plot-unselected-label">${name}</div>
    </>
  }
}

class BottomPlotView extends Component<{ column: ColumnSlice, xDomain: [number, number], color: string }> {
  plotElt = createRef<HTMLDivElement>();
  lastIndex = null;

  plot(parent: HTMLDivElement) {
    parent.textContent = "";

    let width = parent.offsetWidth;
    width = !width ? 640 : width;
    const height = parent.offsetHeight;

    const marks = [];
    const col = this.props.column;
    if (col.values.length >= 2) { // avoid high cardinality warning in Plot.
      const start = col.range.start;
      marks.push(Plot.lineY(col.values, { x: (_, i) => i + start, stroke: this.props.color }));
    }

    parent.appendChild(Plot.plot({
      width: width,
      height: height,
      marks: marks,
      x: {
        domain: this.props.xDomain,
        axis: null,
      },
      y: {
        nice: true,
        zero: false,
      }
    }));
  }

  componentDidMount() {
    this.componentDidUpdate();
  }

  componentDidUpdate() {
    this.plot(this.plotElt.current);
  }

  render() {
    return <>
      <div class="bottom-plot-label" key={"label-" + this.props.column.name}>
        <div>{this.props.column.name}</div>
      </div>
      <div class="bottom-plot-view"
        key={this.props.column.name}
        ref={this.plotElt}>
      </div>
    </>
  }
}
