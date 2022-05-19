'use strict';

import { h, Component, ComponentChildren, toChildArray, VNode } from 'preact';
import { AppProps, SelectedTab } from './state';
import { PlotView } from './plot';
import { TermView } from './term';
import { TableSlice, Range, range, sliceToCSV } from './csv';
import { blob } from 'node:stream/consumers';

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
  const disabledTabs: SelectedTab[] =
    props.state.status != "closed" ? [SelectedTab.save] : [];

  let zoom = <div></div>;
  if (props.tab == SelectedTab.plot) {
    const zoomRange = props.plotSettings.zoomRange;
    zoom = <div class="zoom">
      Zoom <input
        type="range"
        disabled={zoomRange.length == 0}
        min={zoomRange.start} max={zoomRange.end}
        value={props.plotSettings.range.length}
        onInput={(e) => props.zoom(Number(e.currentTarget.value))} />
    </div>
  }

  const enabledColumns = props.plotSettings.columnStates.enabledColumns;

  return <div class="app-view">
    <div>
      {stopButton()}
    </div>
    <TabView
      labels={tabs}
      disabledLabels={disabledTabs}
      rightOfTabs={zoom}
      selected={props.tab}
      chooseTab={props.chooseTab}>
      <TermView logKey={log.key} lines={log.head} truncateRows windowChanges={props.windowChanges} />
      <TermView logKey={log.key} lines={log.tail} windowChanges={props.windowChanges} />
      {table == null ? "<div></div>" : <PlotView
        status={props.state.status}
        table={table}
        settings={props.plotSettings}
        windowChanges={props.windowChanges}
        toggleColumn={props.toggleColumn}
        pan={props.pan} />}
      <SaveView slice={table} columns={enabledColumns}/>
    </TabView>
  </div>;
}

interface TabProps {
  labels: string[];
  disabledLabels?: string[];
  rightOfTabs?: VNode;
  selected: string;
  chooseTab: (label: string) => void;
  children: ComponentChildren;
}

const TabView = (props: TabProps) => {
  const selected = props.selected;
  const disabled = new Set(props.disabledLabels ?? []);
  const labels = props.labels;
  const children = toChildArray(props.children);

  const renderTab = (label: string) => {
    if (disabled.has(label)) {
      return <li class="pure-menu-item pure-menu-disabled"><a class="pure-menu-link">{label}</a></li>
    }

    let classes = "pure-menu-item";
    if (label == selected) classes += " pure-menu-selected";

    return <li class={classes}>
      <a href="#" class="pure-menu-link" onClick={() => props.chooseTab(label)}
      >{label}</a>
    </li>
  }

  return <div class="tab-view">
    <div class="tab-row">
      <div class="pure-menu pure-menu-horizontal"><ul class="pure-menu-list">
        {labels.map(renderTab)}
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

class SaveView extends Component<{slice: TableSlice, columns: string[] }> {
  downloadURL = null as string;
  size = null as string;

  componentWillMount() {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(sliceToCSV(this.props.slice, {columns: this.props.columns}));
    const blob = new Blob([bytes]);
    this.downloadURL = URL.createObjectURL(blob);
    this.size = `${Math.round(bytes.length / 1000)}K`;
  }

  shouldComponentUpdate() {
    this.componentDidUnmount();
    this.componentWillMount();
    return true;
  }

  componentDidUnmount() {
    URL.revokeObjectURL(this.downloadURL);
    this.downloadURL = null;
    this.size = null;
  }

  render() {
    const included = new Set(this.props.columns);
    const excluded = this.props.slice.columnNames.filter((c) => !included.has(c));
    const sliceRows = this.props.slice.rows;
    const allRows = this.props.slice.allRows;
    return <div>
      <p>Save
        {sliceRows.length < allRows.length ? ` ${sliceRows.length} of` : ""
          } {allRows.length} rows as a {this.size} CSV file.</p>
      <p>Columns included: {this.props.columns.join(", ")}</p>
      {excluded.length == 0 ? "" : <p>Columns excluded: {excluded.join(", ")}</p>}
      <a class="pure-button" href={this.downloadURL} download="data.csv">Save CSV</a>
    </div>
  }
}
