'use strict';

import { h, Component, ComponentChildren, toChildArray, createRef } from 'preact';
import { Table } from './csv';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import * as Plot from "@observablehq/plot";
import { LogLine, PlotSettings, AppProps } from './state';

export const ConnectView = (props: { onClick: () => void }) => {
  return <div>
    <button id="connect" onClick={props.onClick} class="pure-button pure-button-primary">Connect</button>
  </div>;
}

export const AppView = (props: AppProps) => {

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

  const log = props.state.log;
  const table = props.table;

  return <div class="port-view">
    <div>
      {button()}
    </div>
    <TabView labels={["Head", "Tail", "Plot"]} defaultSelected={1} >
      <TermView logKey={log.key} lines={log.head} truncateRows windowChanges={props.windowChanges} />
      <TermView logKey={log.key} lines={log.tail} windowChanges={props.windowChanges} />
      {table == null ? "" : <PlotView table={table} settings={props.plotSettings} windowChanges={props.windowChanges} toggleColumn={props.toggleColumn} />}
    </TabView>
  </div>;
}

interface TabProps {
  labels: string[];
  defaultSelected: number;
  children: ComponentChildren;
}

class TabView extends Component<TabProps, { selected: number }> {
  state = { selected: 0 }

  componentDidMount(): void {
    this.setState({ selected: this.props.defaultSelected })
  }

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

function getColorRange(colorCount: number, observablePlotColorScheme: string): string[] {
  const colorDomain = new Array(colorCount).fill(0).map((_, i) => i);

  const colorScale = Plot.scale({
    color: {
      type: "categorical",
      scheme: observablePlotColorScheme,
      domain: colorDomain
    }
  });

  return colorDomain.map((d) => colorScale.apply(d));
}

const colorRange = getColorRange(10, "tableau10")

interface PlotProps {
  table: Table;
  settings: PlotSettings;
  windowChanges: number;
  toggleColumn: (name: string) => void;
}

class PlotView extends Component<PlotProps> {
  plotElt = createRef<HTMLDivElement>();
  lastIndex = null;

  colorAt(i: number): string {
    return colorRange[i];
  }

  plot(parent: HTMLDivElement) {
    parent.textContent = "";

    let width = parent.offsetWidth;
    width = !width ? 640 : width;

    let height = parent.offsetHeight - 50;

    const columnNames = this.props.table.columnNames;
    const cols = this.props.table.columns;
    const rowsScrolled = this.props.table.rowsRemoved;
    this.lastIndex = this.props.table.indexes.at(-1);

    let marks = [];
    if (this.props.table.rowCount >= 2) { // avoid high cardinality warning in Plot.
      for (let i = 0; i < columnNames.length; i++) {
        if (this.props.settings.selectedColumns.has(columnNames[i])) {
          marks.push(Plot.lineY(cols[i], { x: this.props.table.indexes, stroke: this.colorAt(i) }));
        }
      }
    }

    parent.appendChild(Plot.plot({
      width: width,
      height: height,
      marks: marks,
      x: {
        domain: [rowsScrolled, rowsScrolled + this.props.table.rowLimit]
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

  shouldComponentUpdate(nextProps: PlotProps): boolean {
    return (!document.hidden && this.lastIndex != nextProps.table.indexes.at(-1)) ||
      this.props.windowChanges != nextProps.windowChanges ||
      this.props.settings != nextProps.settings;
  }

  componentDidUpdate() {
    this.plot(this.plotElt.current);
  }

  render() {
    const makeToggleButton = (name: string, i: number) => {
      return <button
        onClick={() => this.props.toggleColumn(name)}
        class={"pure-button" + (this.props.settings.selectedColumns.has(name) ? " button-pressed" : "")}
      ><span class="swatch" style={`background-color: ${this.colorAt(i)}`}> </span> {name}</button>
    };
    return <div class="plot-view">
      <div class="plot-left" role="group">
        {this.props.table.columnNames.map((name, i) => makeToggleButton(name, i))}
      </div>
      <div class="plot-right" ref={this.plotElt} />
    </div>;
  }
}
