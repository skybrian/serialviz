export {}

let connectElt = document.getElementById("connect") as HTMLButtonElement;
let outputElt = document.getElementById("output") as HTMLTextAreaElement;

var connected = false;

async function connect() {
    
    connectElt.disabled = true;

    let port = await navigator.serial.requestPort();

    connected = true;
    let info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);

    await port.open({ baudRate: 9600 });
    connectElt.textContent = "Connected";

    let decoder = new TextDecoderStream();
    let closed = port.readable.pipeTo(decoder.writable);
    let reader = decoder.readable.getReader();

    outputElt.value = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // Allow the serial port to be closed later.
          reader.releaseLock();
          break;
        }
        
        let end = outputElt.value.length;
        outputElt.setRangeText(value, end, end);
        outputElt.scrollTop = outputElt.scrollHeight;
      }
 }

connectElt.addEventListener("click", connect);
