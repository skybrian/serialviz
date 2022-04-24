import { Terminal } from 'xterm';
export {}

var [startElt, connectedElt, terminalElt] =
  ["start", "connected", "terminal"].map((id) => document.getElementById(id)) as HTMLDivElement[];

let [connectElt, pauseElt] =
  ["connect", "pause"].map((id) => document.getElementById(id)) as HTMLButtonElement[];

let terminal = new Terminal({
  rows: 50,
  scrollback: 0,
});
terminal.open(terminalElt);

async function connect() {
    connectElt.disabled = true;

    let port = await navigator.serial.requestPort();

    let info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);

    await port.open({
      baudRate: 115200,
      bufferSize: 40,
      flowControl: "hardware",
     });

    onConnected(port);
}

function onConnected(port: SerialPort) {

  var paused = false;

  var copyDone: Promise<void>;

  function writeStatus(e) {
    terminal.write(`\n*** ${e} ***\r\n\r\n`);
  }

  function fatal(e) {
    writeStatus(e);
    pauseElt.disabled = true;
  }

  async function copyToTerminal(): Promise<void> {
    let reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        terminal.write(value);
        if (paused) {
          writeStatus("Paused");
          return;
        } else if (done) {
          fatal("Done");
          return;
        }
      }
    } catch(e) {
      fatal(e);
    } finally {
      reader.releaseLock();
    }
  }

  function onPause() {
    paused = !paused;
    pauseElt.textContent = paused ? "Resume" : "Pause";
    if (!paused) {
      copyDone.then(() => {
        copyDone = copyToTerminal();
      });
    }
  }

  startElt.style.display = "none";
  connectedElt.style.display = "block";
  copyDone = copyToTerminal();
  pauseElt.addEventListener("click", onPause);
}

connectElt.addEventListener("click", connect);
