'use strict';

import { TableBuffer, TableSlice, Row, parseRow, range, Range } from './csv';

const logHeadLimit = 100;
const logTailLimit = 100;
const tableBufferLimit = 10000;
const zoomRangeStart = 500;

const bottomColumnLimit = 4;

export type PortStatus = "start" | "connecting" | "reading" | "closing" | "closed" | "portGone";

export interface Log {
  key: number,
  head: LogLine[],
  tail: LogLine[]
}

export interface LogLine {
  key: number,
  value: string
}

export interface PortState {
  status: PortStatus;
  log: Log;
}

export type ColumnState = "top" | "bottom" | "hidden";

export interface PlotSettings {
  columnStates: ColumnStates;
  range: Range;
  bounds: Range;
  zoomRange: Range;
}

export class ColumnStates {
  private states: Map<string, ColumnState>;

  constructor(states?: Map<string, ColumnState>) {
    this.states = states ?? new Map();
  }

  has = (name: string): boolean => this.states.has(name);

  get(name: string): ColumnState {
    return this.states.get(name) ?? "hidden";
  }

  get columns(): string[] {
    return [...this.states.keys()];
  }

  get enabledColumns(): string[] {
    return this.columns.filter(c => this.get(c) != "hidden" );
  }

  withColumns(tableColumns: string[]): ColumnStates {
    const newColumns = tableColumns.filter((c) => !this.has(c));
    const topColumns = this.columns.filter((c) => this.get(c) == "top");
    const bottomColumns = this.columns.filter((c) => this.get(c) == "bottom");

    if (newColumns.length == 0) return this;

    const next = new Map<string, ColumnState>();
    if (topColumns.length == 0) {
      next.set(newColumns.shift(), "top");
    }

    for (let i = 0; i < bottomColumnLimit - bottomColumns.length; i++) {
      const c = newColumns.shift();
      if (!c) break;
      next.set(c, "bottom");
    }

    while (newColumns.length > 0) {
      const c = newColumns.shift();
      next.set(c, "hidden");
    }

    for (let c of this.columns) {
      next.set(c, this.get(c));
    }

    return new ColumnStates(next);
  }

  withToggle(name: string): ColumnStates {
    const newStates = new Map(this.states);

    let toggled: ColumnState;
    switch (this.get(name)) {
      case "top": toggled = "bottom"; break;
      case "bottom": toggled = "hidden"; break;
      case "hidden": toggled = "top"; break;
    }

    newStates.set(name, toggled);
    return new ColumnStates(newStates);
  }
}

export enum SelectedTab {
  head = "Head",
  tail = "Tail",
  plot = "Plot",
  save = "Save"
}

export interface AppProps {
  state: PortState;
  table: TableSlice;
  tab: SelectedTab;
  plotSettings: PlotSettings;
  windowChanges: number;

  stop: () => void;
  restart: () => void;
  chooseTab: (tab: SelectedTab) => void;
  toggleColumn: (name: string) => void;
  zoom: (windowSize: number) => void;
  pan: (deltaRows: number) => void;
}

export interface DeviceOutput {
  deviceOpened(): boolean;
  deviceClosed(): void;
  deviceCrashed(message: any): void;
  pushDeviceOutput(line: string): void;
}

export class AppState extends EventTarget implements DeviceOutput {
  #status = "start" as PortStatus;

  #log = { key: 0, head: [], tail: [] } as Log;
  #linesAdded = 0;

  #rows = new TableBuffer(tableBufferLimit);

  #tab = SelectedTab.tail;
  #plotSettings = {
    columnStates: new ColumnStates(),
    range: range(0, zoomRangeStart),
    bounds: range(0, zoomRangeStart),
    zoomRange: range(zoomRangeStart, zoomRangeStart) };

  #windowChanges = 0;

  constructor() {
    super();
  }

  // getters

  get props(): AppProps {
    const fullRange = this.#rows.range;
    const plotRange = this.#plotSettings.range;
    const rowRange = range(Math.max(fullRange.start, plotRange.start), Math.min(fullRange.end, plotRange.end));
    return {
      state: { status: this.#status, log: this.#log },
      table: this.#rows.slice(rowRange),
      tab: this.#tab,
      plotSettings: this.#plotSettings,
      windowChanges: this.#windowChanges,

      stop: this.requestClose,
      restart: this.requestRestart,
      chooseTab: this.chooseTab,
      toggleColumn: this.toggleColumn,
      zoom: this.zoom,
      pan: this.pan,
    }
  }

  get status() {
    return this.#status;
  }

  canChangeTo(request: PortStatus): boolean {
    switch (this.status) {
      case "start":
        return request == "connecting";
      case "connecting":
        return request == "reading" || request == "closing" || request == "portGone";
      case "reading":
        return request == "closing" || request == "portGone";
      case "closing":
        return request == "closed" || request == "portGone";
      case "closed":
        return request == "connecting" || request == "portGone";
      case "portGone":
      // terminal state
    }
    return false;
  }

  // device actions

  deviceOpened = (): boolean => this.requestChange("reading");

  deviceClosed(): void {
    this.requestChange("closed", { message: "Closed" });
  }

  deviceCrashed(message: any): void {
    this.requestChange("portGone", { message: message });
  }

  pushDeviceOutput(line: string): void {
    this.#pushLog(line);
    const row = parseRow(line);
    if (row) {
      this.#pushRow(row);
    }
    this.#save();
  }

  // other actions

  pushLog(line: string): void {
    this.#pushLog(line);
    this.#save();
  }

  #pushRow(row: Row): void {
    const prevKey = this.#rows.key;

    this.#rows.push(row);

    if (prevKey != this.#rows.key) {
      const next = this.#plotSettings.columnStates.withColumns(this.#rows.columnNames);
      this.#plotSettings = { ...this.#plotSettings, columnStates: next};
    }

    let bounds = this.#rows.range;
    if (bounds.end < zoomRangeStart) {
      bounds = range(bounds.start, zoomRangeStart);
    }

    const zoomRangeEnd = bounds.length;

    let plotRange = this.#plotSettings.range;
    if (plotRange.end == bounds.end - 1) {
      plotRange = range(plotRange.start + 1, plotRange.end + 1);
    }

    this.#plotSettings = { ...this.#plotSettings,
      range: plotRange,
      bounds: bounds,
      zoomRange: range(zoomRangeStart, zoomRangeEnd)
    };
  }

  #pushLog(line: string): void {
    const logLine = { key: this.#linesAdded, value: line };

    let head = this.#log.head;
    if (head.length < logHeadLimit) {
      head = head.concat([logLine]);
    }

    let tail = this.#log.tail;
    if (tail.length < logTailLimit) {
      tail = tail.concat([logLine]);
    } else {
      tail = tail.slice(1).concat(logLine);
    }

    this.#log = { key: this.#log.key, head: head, tail: tail };
    this.#linesAdded++;
  }

  // other actions

  requestClose = (): boolean => this.requestChange("closed", { optional: true }) || this.requestChange("closing");

  requestRestart = (): boolean => this.requestChange("connecting");

  requestChange(wanted: PortStatus, options = {} as { message?: any, optional?: boolean }): boolean {
    if (!this.canChangeTo(wanted)) {
      if (!options.optional) {
        console.log(`ignored port change: ${this.status} => ${wanted}`);
      }
      return false;
    }

    if (wanted == "connecting") {
      this.#log = { key: this.#log.key + 1, head: [], tail: [] };
      this.#linesAdded = 0;
      this.#rows.clear();
      if (this.#tab == SelectedTab.save) {
        this.#tab = SelectedTab.plot;
      }
      this.#plotSettings = {...this.#plotSettings,
        range: range(0, zoomRangeStart),
        bounds: range(0, zoomRangeStart),
        zoomRange: range(zoomRangeStart, zoomRangeStart)
      };
    }

    if (options.message) {
      this.pushLog(`*** ${options.message} ***`);
    }

    this.#status = wanted;
    this.dispatchEvent(new CustomEvent("status"));
    this.#save();
    return true;
  }

  chooseTab = (tab: SelectedTab): void => {
    this.#tab = tab;
    this.#save();
  }

  toggleColumn = (name: string): void => {
    const toggled = this.#plotSettings.columnStates.withToggle(name);
    this.#plotSettings = { ...this.#plotSettings, columnStates: toggled };
    this.#save();
  }

  zoom = (windowSize: number): void => {
    let plot = this.#plotSettings.range;
    const full = this.#rows.range;

    if (plot.end == full.end) {
      plot = range(Math.max(full.start, full.end - windowSize), full.end);
    } else {
      const middle = plot.start + plot.length/2;
      const start = Math.max(full.start, Math.min(full.end - windowSize, Math.floor(middle - windowSize/2)));
      const end = Math.max(zoomRangeStart, Math.min(start + windowSize, full.end));
      plot = range(start, end);
    }

    this.#plotSettings = { ...this.#plotSettings, range: plot };
    this.#save();
  }

  pan = (delta: number) => {
    const bounds = this.#plotSettings.bounds;
    const old = this.#plotSettings.range;
    if (delta < 0 && old.start + delta < bounds.start) {
      delta = bounds.start - old.start;
    } else if (delta > 0 && old.end + delta > bounds.end) {
      delta = bounds.end - old.end;
    }
    if (delta != 0) {
      const newRange = range(old.start + delta, old.end + delta);
      this.#plotSettings = { ...this.#plotSettings, range: newRange};
      this.#save();
    }
  }

  windowChanged(): void {
    this.#windowChanges++;
    this.#save();
  }

  #save(): void {
    this.dispatchEvent(new CustomEvent("save"));
  }
}
