'use strict';

import { h, Component, Fragment } from 'preact';
import { AppProps, SaveSettings, SelectedTab } from './state';
import { PlotView } from './plot';
import { TermView } from './term';
import { TabView } from './tabs';
import { TableSlice, sliceToCSV } from './csv';

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
      {table == null ? <div>Waiting for data...</div> : <PlotView
        status={props.state.status}
        table={table}
        settings={props.plotSettings}
        windowChanges={props.windowChanges}
        toggleColumn={props.toggleColumn}
        pan={props.pan} />}
      <SaveView slice={table} columns={enabledColumns} settings={props.saveSettings} setFilePrefix={props.setSaveFilePrefix} />
    </TabView>
  </div>;
}

interface SaveProps {
  slice: TableSlice;
  columns: string[];
  settings: SaveSettings;
  setFilePrefix: (name: string) => void;
}

class SaveView extends Component<SaveProps> {
  downloadURL = null as string;
  size = null as string;

  componentWillMount() {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(sliceToCSV(this.props.slice, { columns: this.props.columns }));
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

  get suffix() {
    return `_${this.rowCount}rows.csv`;
  }

  get filename() {
    return this.props.settings.filePrefix + this.suffix;
  }

  get colCount() {
    return this.props.columns.length;
  }

  get rowCount() {
    return this.props.slice.rows.length
  }

  onFilePrefixChange = (e) => {
    this.props.setFilePrefix(e.target.value);
  }

  renderFilename() {
    const props = this.props;

    return <div class="pure-control-group">
      <label for="file-prefix-input">Filename</label>
      <input type="text" id="file-prefix-input"
        value={this.props.settings.filePrefix}
        onInput={this.onFilePrefixChange} />{this.suffix}
    </div>
  }

  renderFormItem(label: string, text: string) {
    return <div class="pure-control-group">
      <label>{label}</label>
      <span class="form-item-text">{text}</span>
    </div>;
  }

  renderIncludedColumns() {
    const included = new Set(this.props.columns);
    const excluded = this.props.slice.columnNames.filter((c) => !included.has(c));
    return <>
      {this.renderFormItem("Included Columns", this.props.columns.join(", "))}
      {excluded.length == 0 ? "" : this.renderFormItem("Excluded Columns", excluded.join(", "))}
    </>
  }

  renderIncludedRows() {
    const allRows = this.props.slice.allRows.length;

    const text = (this.rowCount == allRows) ?
      `all ${this.rowCount} rows in buffer.` :
      `${this.rowCount} of ${allRows} rows in buffer.`;
    return this.renderFormItem("Included Rows", text);
  }

  render() {
    return <form class="pure-form pure-form-aligned">
      <h2>Save currently plotted data to a CSV file</h2>
      <fieldset>
        {this.renderFilename()}
        {this.renderFormItem("Size", this.size)}
        {this.renderIncludedColumns()}
        {this.renderIncludedRows()}
        <a class="pure-button" href={this.downloadURL} download={this.filename}>Save File</a>
      </fieldset>
    </form>
  }
}
