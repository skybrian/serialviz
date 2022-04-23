import { Terminal } from 'xterm';
export {}

let connectElt = document.getElementById("connect") as HTMLButtonElement;
let terminalElt = document.getElementById("terminal") as HTMLDivElement;

let terminal = new Terminal({
  rows: 50,
  scrollback: 0,
});
terminal.open(terminalElt);

var connected = false;

async function connect() {
    
    connectElt.disabled = true;

    let port = await navigator.serial.requestPort();

    connected = true;
    let info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);

    await port.open({
      baudRate: 115200,
      bufferSize: 4096,
      flowControl: "hardware",
     });
    connectElt.textContent = "Connected";

    terminal.clear();

    let reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }  
        terminal.write(value);
      }
    } finally {
      reader.releaseLock();
    }
 }

connectElt.addEventListener("click", connect);
