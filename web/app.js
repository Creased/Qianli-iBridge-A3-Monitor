// UI Elements
const connectBtn = document.getElementById('connect-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Web Serial Variables
let port = null;
let reader = null;
let keepReading = false;

// Statistics & History
let vMax = 0, vMin = 99.0;
let iMax = 0, iMin = 99.0;
let historyV = [];
let historyI = [];
let isDrawing = false; // Prevent multiple animation frames

// CSV Logging
const csvBtn = document.getElementById('csv-btn');
let csvData = ["Time(s),Voltage(V),Current(A),Power(W)"];
let startTimeMs = 0;

// uPlot Setup
let uplotChart;
let data = [
    [], // X Axis (Time)
    [], // Y1 (Voltage)
    [], // Y2 (Current)
];

// State for auto-scrolling
let isAutoScrolling = true;
let currentWindow = 10; // Default 10 seconds wide

// uPlot Wheel Zoom Plugin
function wheelZoomPlugin() {
    let factor = 0.75;
    let xMin, xMax, yMin, yMax, xRange, yRange;

    function clamp(nRange, nMin, nMax, fRange, fMin, fMax) {
        if (nRange > fRange) {
            nMin = fMin;
            nMax = fMax;
        } else if (nMin < fMin) {
            nMin = fMin;
            nMax = fMin + nRange;
        } else if (nMax > fMax) {
            nMax = fMax;
            nMin = fMax - nRange;
        }
        return [nMin, nMax];
    }

    return {
        hooks: {
            ready: u => {
                xMin = u.scales.x.min;
                xMax = u.scales.x.max;
                yMin = u.scales.y_v.min;
                yMax = u.scales.y_v.max; // Using y_v as reference if needed

                let over = u.over;
                let rect = over.getBoundingClientRect();

                // wheel drag pan
                over.addEventListener("mousedown", e => {
                    if (e.button === 0) { // left click drag
                        let srcLeft = e.clientX;
                        let xMin0 = u.scales.x.min;
                        let xMax0 = u.scales.x.max;

                        let drag = e => {
                            isAutoScrolling = false; // Disable auto-scroll on pan
                            document.getElementById('uplot-chart').classList.add('interacting');

                            let dx = e.clientX - srcLeft;
                            let dxSc = dx / rect.width * (xMax0 - xMin0);
                            u.setScale("x", { min: xMin0 - dxSc, max: xMax0 - dxSc });
                        };

                        let drop = e => {
                            document.removeEventListener("mousemove", drag);
                            document.removeEventListener("mouseup", drop);
                            document.getElementById('uplot-chart').classList.remove('interacting');

                            // Check if snapped back to live edge
                            if (data[0].length > 0) {
                                let latestTime = data[0][data[0].length - 1];
                                if (u.scales.x.max >= latestTime - 0.5) {
                                    isAutoScrolling = true;
                                    currentWindow = u.scales.x.max - u.scales.x.min;
                                }
                            }
                        };

                        document.addEventListener("mousemove", drag);
                        document.addEventListener("mouseup", drop);
                    }
                });

                // wheel scroll zoom
                over.addEventListener("wheel", e => {
                    e.preventDefault();
                    isAutoScrolling = false; // Disable auto-scroll on zoom

                    let { left, top } = u.cursor;
                    let leftPct = left / rect.width;
                    let btmPct = 1 - top / rect.height;
                    let xVal = u.posToVal(left, "x");
                    let yVal = u.posToVal(top, "y_v");
                    let oxRange = u.scales.x.max - u.scales.x.min;
                    let oyRange = u.scales.y_v.max - u.scales.y_v.min;

                    let nxRange = e.deltaY < 0 ? oxRange * factor : oxRange / factor;
                    let nxMin = xVal - leftPct * nxRange;
                    let nxMax = nxMin + nxRange;

                    // Enforce minimum zoom window to prevent crash
                    if (nxRange > 0.1) {
                        currentWindow = nxRange; // Update window size for later auto scroll
                        u.batch(() => {
                            u.setScale("x", { min: nxMin, max: nxMax });
                        });
                    }

                    // Check if zoomed out to live edge
                    if (data[0].length > 0) {
                        let latestTime = data[0][data[0].length - 1];
                        if (nxMax >= latestTime) {
                            isAutoScrolling = true;
                        }
                    }
                });
            }
        }
    };
}

// uPlot Tooltip Plugin
function tooltipPlugin() {
    let tooltip;

    return {
        hooks: {
            ready: u => {
                let over = u.over;
                tooltip = document.createElement("div");
                tooltip.className = "u-tooltip";
                over.appendChild(tooltip); // Append directly to the overlay layer for precise absolute positioning

                // Hide tooltip when mouse leaves the chart
                over.addEventListener("mouseleave", () => {
                    tooltip.classList.remove("visible");
                });

                // Show tooltip when mouse enters
                over.addEventListener("mouseenter", () => {
                    tooltip.classList.add("visible");
                });
            },
            setCursor: u => {
                if (!tooltip) return;

                const { left, top, idx } = u.cursor;

                if (idx === null || left < 0 || top < 0) {
                    tooltip.classList.remove("visible");
                    return;
                }

                tooltip.classList.add("visible");

                // Get values at hovered index
                let time = u.data[0][idx];
                let v = u.data[1][idx];
                let i = u.data[2][idx];

                // Build Tooltip HTML
                tooltip.innerHTML = `
                    <div class="u-tooltip-time">${time.toFixed(3)}s</div>
                    <div class="u-tooltip-row">
                        <span>Voltage:</span> <span class="u-tooltip-val-v">${v != null ? v.toFixed(3) + ' V' : '-'}</span>
                    </div>
                    <div class="u-tooltip-row">
                        <span>Current:</span> <span class="u-tooltip-val-i">${i != null ? i.toFixed(3) + ' A' : '-'}</span>
                    </div>
                `;

                // Position the tooltip near the cursor
                let overRect = u.over.getBoundingClientRect();
                let tooltipRect = tooltip.getBoundingClientRect();

                let tx = left + 15; // Offset from cursor
                let ty = top + 15;

                // Keep on screen relative to overlay box
                if (tx + tooltipRect.width > overRect.width) tx = left - tooltipRect.width - 15;
                if (ty + tooltipRect.height > overRect.height) ty = top - tooltipRect.height - 15;

                tooltip.style.left = tx + "px";
                tooltip.style.top = ty + "px";
            }
        }
    };
}

function initPlot() {
    const opts = {
        title: "Live Monitoring",
        width: document.getElementById('uplot-chart').clientWidth,
        height: document.getElementById('uplot-chart').clientHeight,
        plugins: [wheelZoomPlugin(), tooltipPlugin()],
        cursor: {
            sync: { key: "foo" },
            drag: { x: false, y: false } // disable default drag to select zoom
        },
        scales: {
            x: {
                time: false,
                range: (u, min, max) => {
                    if (u.data[0].length === 0) return [0, currentWindow];
                    return [min, max];
                }
            },
            y_v: { auto: true, range: (u, min, max) => [0, isNaN(max) || max === null ? 5 : Math.max(5, max * 1.1)] },
            y_i: { auto: true, range: (u, min, max) => [0, isNaN(max) || max === null ? 1 : Math.max(1, max * 1.1)] }
        },
        axes: [
            {
                scale: 'x',
                label: "Time (s)",
                stroke: "#c0c0c0",
                grid: { show: true, stroke: "rgba(255,255,255,0.1)" },
                space: 50,
                size: 40,
                values: (u, vals) => vals.map(v => v.toFixed(1) + "s")
            },
            {
                scale: 'y_v',
                label: "Voltage (V)",
                stroke: "#00ff55",
                grid: { show: true, stroke: "rgba(255,255,255,0.1)" },
                values: (u, vals) => vals.map(v => v.toFixed(2))
            },
            {
                scale: 'y_i',
                label: "Current (A)",
                stroke: "#ffcc00",
                side: 1,
                grid: { show: false },
                values: (u, vals) => vals.map(v => v.toFixed(3))
            }
        ],
        series: [
            { value: (u, v) => v == null ? "-" : v.toFixed(2) + "s" },
            { label: "Voltage", scale: "y_v", stroke: "#00ff55", width: 2, points: { show: false }, value: (u, v) => v == null ? "-" : v.toFixed(3) + " V" },
            { label: "Current", scale: "y_i", stroke: "#ffcc00", width: 2, points: { show: false }, value: (u, v) => v == null ? "-" : v.toFixed(3) + " A" }
        ],
        padding: [10, 20, 30, 10] // [top, right, bottom, left] 30px bottom for labels
    };

    let container = document.getElementById('uplot-chart');
    container.innerHTML = "";
    uplotChart = new uPlot(opts, data, container);
}

function resizePlot() {
    if (uplotChart) {
        uplotChart.setSize({
            width: document.getElementById('uplot-chart').clientWidth,
            height: document.getElementById('uplot-chart').clientHeight
        });
    }
}
window.addEventListener('resize', resizePlot);
// Init on load
setTimeout(initPlot, 100);

// Demo Data Generation
const demoBtn = document.getElementById('demo-btn');
demoBtn.addEventListener('click', () => {
    // Generate 30 seconds of realistic USB trace at 100Hz
    let t = 0;
    vMax = 0; vMin = 99.0; iMax = 0; iMin = 99.0;
    data = [[], [], []];

    let baseV = 5.08;
    let baseI = 0.02;

    for (let i = 0; i < 3000; i++) {
        t += 0.01;
        let v = baseV + (Math.random() * 0.02 - 0.01);
        let curr = baseI + (Math.random() * 0.01 - 0.005);

        // Simulate a device plugging in and pulling current in stages
        if (t > 2 && t < 5) {
            curr += 0.25; // Handshake
            v -= 0.1;
        } else if (t >= 5 && t < 15) {
            // Charging phase
            curr += 1.2 + Math.sin(t * 5) * 0.05;
            v -= 0.35 + Math.random() * 0.02;
        } else if (t >= 15 && t < 20) {
            // Heavy draw pulse
            curr += (Math.sin(t * 10) > 0 ? 2.5 : 0.5);
            v -= (Math.sin(t * 10) > 0 ? 0.8 : 0.15);
        } else if (t >= 20 && t < 28) {
            // Screen on, idle
            curr += 0.8;
            v -= 0.2;
        }

        data[0].push(t);
        data[1].push(v);
        data[2].push(curr);

        // Update stats
        if (v > vMax) vMax = v;
        if (v < vMin) vMin = v;
        if (curr > iMax) iMax = curr;
        if (curr < iMin) iMin = curr;
    }

    // Set UI limits
    document.getElementById('v-max').innerText = vMax.toFixed(3);
    document.getElementById('v-min').innerText = vMin.toFixed(3);
    document.getElementById('i-max').innerText = iMax.toFixed(3);
    document.getElementById('i-min').innerText = iMin.toFixed(3);

    // Set last values to labels
    let lastV = data[1][data[1].length - 1];
    let lastI = data[2][data[2].length - 1];
    document.getElementById('val-v').innerText = lastV.toFixed(3);
    document.getElementById('val-i').innerText = lastI.toFixed(3);
    document.getElementById('val-p').innerText = (lastV * lastI).toFixed(3);

    startTimeMs = Date.now() - (t * 1000); // Fake start time for continuity if desired

    if (uplotChart) {
        // Reset X scale to show full trace
        uplotChart.setScale('x', { min: 0, max: 30 });
        isAutoScrolling = false; // Disable auto scroll so user can view it safely
        uplotChart.setData(data, false);
    }
});

connectBtn.addEventListener('click', async () => {
    if (port) {
        await disconnect();
    } else {
        await connect();
    }
});

async function connect() {
    try {
        // Request port
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });

        // Update UI
        connectBtn.textContent = 'Disconnect';
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';

        // Reset stats
        vMax = 0; vMin = 99.0; iMax = 0; iMin = 99.0;
        data = [[], [], []];
        if (uplotChart) uplotChart.setData(data);
        csvData = ["Time(s),Voltage(V),Current(A),Power(W)"];
        startTimeMs = Date.now();
        csvBtn.disabled = false;
        csvBtn.textContent = `Download CSV (0)`;

        isAutoScrolling = true;

        keepReading = true;
        readLoop();

        // Send Enable Command
        // DA 01 00 04 05 00 00 00 00
        const writer = port.writable.getWriter();
        const enableCmd = new Uint8Array([0xDA, 0x01, 0x00, 0x04, 0x05, 0x00, 0x00, 0x00, 0x00]);
        await writer.write(enableCmd);
        writer.releaseLock();

    } catch (e) {
        console.error('Connection failed:', e);
    }
}

async function disconnect() {
    keepReading = false;

    // Send Disable Command before closing
    if (port && port.writable) {
        try {
            const writer = port.writable.getWriter();
            const disableCmd = new Uint8Array([0xDA, 0x01, 0x00, 0x04, 0x05, 0x00, 0x00, 0x01, 0x01]);
            await writer.write(disableCmd);
            writer.releaseLock();
        } catch (e) { console.error('Failed to send disable cmd', e); }
    }

    if (reader) {
        await reader.cancel();
    }

    connectBtn.textContent = 'Connect Device';
    statusDot.classList.remove('connected');
    statusText.textContent = 'Disconnected';
}

async function readLoop() {
    let receiveBuffer = new Uint8Array(0);

    while (port.readable && keepReading) {
        reader = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                // Append chunk
                let newBuffer = new Uint8Array(receiveBuffer.length + value.length);
                newBuffer.set(receiveBuffer);
                newBuffer.set(value, receiveBuffer.length);
                receiveBuffer = newBuffer;

                // Parse Buffer
                while (receiveBuffer.length >= 8) {
                    // Sync Magic
                    if (receiveBuffer[0] !== 0xDA) {
                        receiveBuffer = receiveBuffer.slice(1);
                        continue;
                    }

                    let length = receiveBuffer[1] | (receiveBuffer[2] << 8);
                    let totalLen = 8 + length;

                    if (receiveBuffer.length < totalLen) {
                        break; // Wait for full packet
                    }

                    let packet = receiveBuffer.slice(0, totalLen);

                    // Verify Checksum
                    let headerCs = packet[7];
                    let payload = packet.slice(8);
                    let calcCs = 0;
                    for (let i = 0; i < payload.length; i++) {
                        calcCs ^= payload[i];
                    }

                    if (calcCs === headerCs) {
                        // Accept packet
                        receiveBuffer = receiveBuffer.slice(totalLen);

                        let model = packet[3];
                        let cmd = packet[4];

                        if (model === 0x04 && cmd === 0x05 && length === 8) {
                            let view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
                            let val1 = view.getUint32(0, false); // Big Endian
                            let val2 = view.getUint32(4, false); // Big Endian

                            let current_a = val1 / 10000.0;
                            let voltage_v = val2 / 1000.0;

                            updateData(voltage_v, current_a);
                        }
                    } else {
                        // Reject, drop 1 byte to resync
                        receiveBuffer = receiveBuffer.slice(1);
                    }
                }
            }
        } catch (error) {
            console.error('Read error:', error);
        } finally {
            reader.releaseLock();
        }
    }

    if (port) {
        await port.close();
        port = null;
    }
}

function updateData(v, i) {
    // Update Stats (Skip first reading if min is 99 to avoid glitch)
    // Actually, min starts at 99.0 so any normal voltage updates it.
    if (v > vMax) { vMax = v; document.getElementById('v-max').innerText = v.toFixed(3); }
    if (v < vMin) { vMin = v; document.getElementById('v-min').innerText = v.toFixed(3); }
    if (i > iMax) { iMax = i; document.getElementById('i-max').innerText = i.toFixed(3); }
    if (i < iMin) { iMin = i; document.getElementById('i-min').innerText = i.toFixed(3); }

    // Update Digital Displays
    let p = v * i;
    document.getElementById('val-v').innerText = v.toFixed(3);
    document.getElementById('val-i').innerText = i.toFixed(3);
    document.getElementById('val-p').innerText = p.toFixed(3);

    // CSV Logging
    let elapsedSec = (Date.now() - startTimeMs) / 1000.0;
    csvData.push(`${elapsedSec.toFixed(3)},${v.toFixed(3)},${i.toFixed(3)},${p.toFixed(3)}`);
    if (csvData.length % 10 === 0) { // Update button text occasionally
        csvBtn.textContent = `Download CSV (${csvData.length - 1})`;
    }

    // Update uPlot Data
    data[0].push(elapsedSec);
    data[1].push(v);
    data[2].push(i);

    // Maintain memory history limit (max ~1 hour at 100Hz = 360,000 points)
    if (data[0].length > 300000) {
        data[0].shift(); data[1].shift(); data[2].shift();
    }

    if (uplotChart) {
        // Auto-scroll logic
        if (isAutoScrolling) {
            let maxVal = Math.max(currentWindow, elapsedSec);
            uplotChart.setScale('x', {
                min: Math.max(0, maxVal - currentWindow),
                max: maxVal
            });
        }

        // Pass data array (false = don't reset scales to auto since we handle X manually/with plugins)
        uplotChart.setData(data, false);
    }
}

// CSV Export Logic
csvBtn.addEventListener('click', () => {
    if (csvData.length <= 1) return;
    const blob = new Blob([csvData.join("\n")], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `qianli_log_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});
