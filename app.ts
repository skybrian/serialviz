import { Terminal } from 'xterm';
export {}

var [startElt, connectedElt, terminalElt] =
  ["start", "connected", "terminal"].map((id) => document.getElementById(id)) as HTMLDivElement[];

let [connectElt, stopElt] =
  ["connect", "stop"].map((id) => document.getElementById(id)) as HTMLButtonElement[];

let terminal = new Terminal({
  rows: 50,
  scrollback: 0,
});
terminal.open(terminalElt);

async function choosePort() {
    connectElt.disabled = true;

    let port = await navigator.serial.requestPort();

    let info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);

    connect(port);
}

async function connect(port: SerialPort) {
  var paused = false;

  var copyDone: Promise<void>;

  function writeStatus(e) {
    terminal.write(`\n*** ${e} ***\r\n\r\n`);
  }

  function fatal(e) {
    writeStatus(e);
    stopElt.disabled = true;
  }

  async function copyToTerminal(): Promise<void> {
    if (paused) {
      writeStatus("Paused");
      return;
    }

    // Tell other windows to pause, so we don't read the port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.readingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      terminal.clear();

      await port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      let reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          terminal.write(value);
          if (paused || done) {
            return;
          }
        }
      } finally {
        reader.releaseLock();
      }

    } catch (e) {
      fatal(e);
    } finally {
      await port.close();
      writeStatus("Closed Port");
    }
  }

  function onPause() {
    paused = !paused;
    stopElt.textContent = paused ? "Reconnect" : "Pause";
    if (!paused) {
      copyDone.then(() => {
        copyDone = copyToTerminal();
      });
    }
  }

  // Automatically pause when another tab opens.
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key == "readingSerialPort" && !paused) {
      onPause();
    }
  });

  startElt.style.display = "none";
  connectedElt.style.display = "block";
  copyDone = copyToTerminal();
  stopElt.addEventListener("click", onPause);
}

connectElt.addEventListener("click", choosePort);
