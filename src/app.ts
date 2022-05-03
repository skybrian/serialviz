import { Terminal } from 'xterm';
export {}

const [startElt, connectedElt, terminalElt] =
  ["start", "connected", "terminal"].map((id) => document.getElementById(id)) as HTMLDivElement[];

const [connectElt, stopElt] =
  ["connect", "stop"].map((id) => document.getElementById(id)) as HTMLButtonElement[];

const terminal = new Terminal({
  rows: 50,
  scrollback: 0,
});
terminal.open(terminalElt);

async function choosePort() {
    connectElt.disabled = true;

    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      connectElt.disabled = false;
      throw e;
    }

    const info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);

    connect(port);
}

async function connect(port: SerialPort) {
  let stopped = false;

  let copyDone: Promise<void>;

  function writeStatus(e) {
    terminal.write(`\n*** ${e} ***\r\n\r\n`);
  }

  function fatal(e) {
    writeStatus(e);
    stopElt.disabled = true;
  }

  async function copyToTerminal(): Promise<void> {
    try {
      await doCopyToTerminal();
    } catch (e) {
      fatal(e);
    }
  }

  async function doCopyToTerminal(): Promise<void> {
    if (stopped) return;

    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (stopped) return;

    terminal.clear();

    await port.open({
      baudRate: 115200,
      bufferSize: 40,
      flowControl: "hardware",
    });

    try {
      if (stopped) return;

      const reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          terminal.write(value);
          if (stopped || done) {
            return;
          }
        }
      } finally {
        reader.releaseLock();
      }

    } finally {
      await port.close();
      writeStatus("Closed Port");
    }
  }

  function onStop() {
    stopped = !stopped;
    stopElt.textContent = stopped ? "Reconnect" : "Pause";
    if (!stopped) {
      copyDone.then(() => {
        copyDone = copyToTerminal();
      });
    }
  }

  // Automatically close the serial port when another tab opens.
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key == "openingSerialPort" && !stopped) {
      onStop();
    }
  });

  startElt.style.display = "none";
  connectedElt.style.display = "block";
  copyDone = copyToTerminal();
  stopElt.addEventListener("click", onStop);
}

connectElt.addEventListener("click", choosePort);
