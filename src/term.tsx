'use strict';

import { h, Component, createRef } from 'preact';
import { LogLine } from './state';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

export interface TermProps {
    logKey: number;
    lines: LogLine[];
    truncateRows?: boolean;
    windowChanges: number;
}

export class TermView extends Component<TermProps> {
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
