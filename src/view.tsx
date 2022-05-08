'use strict';

import { h, Component, ComponentChildren, toChildArray, createRef } from 'preact';
import { Table } from './csv';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import * as Plot from "@observablehq/plot";
import { PortState, LogLine, logHeadLimit } from './state';

export const ConnectView = (props: { onClick: () => void }) => {
  return <div>
    <button id="connect" onClick={props.onClick} class="pure-button pure-button-primary">Connect</button>
  </div>;
}

export const AppView = (props: { state: PortState, table: Table, stop: () => void, restart: () => void }) => {

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
      <TermView logKey={log.key} lines={log.head} scrollback={logHeadLimit} />
      <TermView logKey={log.key} lines={log.tail} scrollback={0} />
      {table == null ? "" : <PlotView {...table} />}
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
  scrollback: number;
}

class TermView extends Component<TermProps> {
  terminal: Terminal;

  currentLog = 0;
  lastLineSeen = -1;

  terminalElt = createRef();

  componentDidMount() {
    this.terminal = new Terminal({
      rows: 50,
      scrollback: this.props.scrollback,
    });
    const fitAddon = new FitAddon();
    this.terminal.loadAddon(fitAddon);
    this.terminal.open(this.terminalElt.current);
    fitAddon.fit();
    this.componentDidUpdate();
  }

  shouldComponentUpdate(nextProps: TermProps): boolean {
    return (
      nextProps.logKey != this.currentLog ||
      nextProps.lines.length == 0 ||
      nextProps.lines.at(-1).key != this.lastLineSeen
    );
  }

  componentDidUpdate() {
    if (this.currentLog != this.props.logKey) {
      this.terminal.clear();
      this.currentLog = this.props.logKey;
      this.lastLineSeen = -1;
    }
    for (let line of this.props.lines) {
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
        domain: [rowsScrolled, rowsScrolled + this.props.rowLimit]
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
