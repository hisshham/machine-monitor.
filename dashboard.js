// ==========================================
// HEJAAZ TECH - Multi-Device Secure Dashboard
// ==========================================
const BASE_API_URL = "https://umrlwzymt3ekunadrnpngatydy0ubhrx.lambda-url.us-east-1.on.aws/";
const ESP32_IP = 'http://hejaaz.local';
let allData = [];
let filteredData = [];
let timelineChart, ratioChart;
let refreshInterval;
let localStatusInterval;
let localStatus = null;
let localLatestRecord = null;
let currentPage = 1;
const rowsPerPage = 15;

// Auth State
let currentMachineId = "";
let currentPasscode = "";

function isLocalDashboard() {
    return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function buildApiUrl(extraParams = {}) {
    const params = new URLSearchParams({
        id: currentMachineId,
        code: currentPasscode,
        ...extraParams
    });
    const baseUrl = isLocalDashboard() ? '/api/data' : BASE_API_URL;
    return `${baseUrl}?${params.toString()}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function showDashboardSession(id, code) {
    currentMachineId = id;
    currentPasscode = code;
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('mainDashboard').style.display = "block";
    document.getElementById('activeMachineName').innerHTML = `MACHINE: <span>${id}</span>`;
    if (refreshInterval) clearInterval(refreshInterval);
    if (localStatusInterval) clearInterval(localStatusInterval);
    refreshInterval = setInterval(fetchData, 5000);
    localStatusInterval = setInterval(fetchLocalStatus, 2000);
    setTimeout(loadFanSchedule, 1000);
    fetchLocalStatus();
}

async function restoreSavedSession() {
    const savedId = localStorage.getItem('hejaaz_id');
    const savedCode = localStorage.getItem('hejaaz_code');
    if (!savedId || !savedCode) return;

    const idInput = document.getElementById('machineId');
    const codeInput = document.getElementById('passCode');
    if (idInput) idInput.value = savedId;
    if (codeInput) codeInput.value = '';

    currentMachineId = savedId;
    currentPasscode = savedCode;
    const success = await fetchData();
    if (success === true) {
        showDashboardSession(savedId, savedCode);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dateInput = document.getElementById('dateFilter');
    if (dateInput) dateInput.value = today;
    restoreSavedSession();
});

async function handleLogin() {
    const id = document.getElementById('machineId').value.trim();
    const code = document.getElementById('passCode').value.trim();
    const errorMsg = document.getElementById('loginError');
    const btn = document.getElementById('btnLogin');

    if (!id || !code) {
        errorMsg.innerText = "Please enter both ID and Passcode";
        errorMsg.style.display = "block";
        return;
    }

    btn.innerText = "Authenticating...";
    btn.disabled = true;
    errorMsg.style.display = "none";

    currentMachineId = id;
    currentPasscode = code;

    const success = await fetchData();

    if (typeof success === 'string') {
        btn.innerText = "Connect to AWS";
        btn.disabled = false;
        errorMsg.innerText = success;
        errorMsg.style.display = "block";
    } else if (success === true) {
        localStorage.setItem('hejaaz_id', id);
        localStorage.setItem('hejaaz_code', code);
        // Clear passcode from screen once logged in
        document.getElementById('passCode').value = '';
        showDashboardSession(id, code);
    } else {
        btn.innerText = "Connect to AWS";
        btn.disabled = false;
        // Display the specific error message if available
        errorMsg.innerText = typeof success === 'string' ? success : "Connection Failed. Check your internet or browser CORS settings.";
        errorMsg.style.display = "block";
    }
}

async function fetchData() {
    const url = buildApiUrl();
    const refreshBtn = document.querySelector('.btn-refresh');
    if (refreshBtn) refreshBtn.innerText = "Syncing...";

    try {
        const response = await fetchWithTimeout(url, {}, 15000);
        if (response.status === 401 || response.status === 500) {
            const errorData = await response.json();
            if (refreshBtn) refreshBtn.innerText = "Refresh";
            return errorData.error || "Authentication Failed";
        }
        if (!response.ok) throw new Error("Network Error");
        const payload = await response.json();
        if (!Array.isArray(payload)) {
            throw new Error(payload.error || "AWS returned non-list data");
        }
        allData = payload;
        updateDashboard(false);
        if (refreshBtn) refreshBtn.innerText = "Synced!";
        setTimeout(() => { if (refreshBtn) refreshBtn.innerText = "Refresh"; }, 2000);
        return true;
    } catch (e) {
        console.error("Fetch Error:", e);
        if (refreshBtn) refreshBtn.innerText = "Error";
        setTimeout(() => { if (refreshBtn) refreshBtn.innerText = "Refresh"; }, 2000);

        if (e.name === 'AbortError') return "Connection Timeout (AWS took too long)";
        return "Network Error: " + e.message;
    }
}

function getCloudMaxCycle() {
    return allData.reduce((max, item) => Math.max(max, parseInt(item.daily_cycles || item.cumulative_cycles || 0, 10) || 0), 0);
}

function formatLocalTimestamp(epochSeconds, cycleNumber) {
    const ts = Number(epochSeconds) || 0;
    if (ts <= 1600000000) return `LOCAL_CYCLE_${cycleNumber || 0}`;
    const d = new Date(ts * 1000);
    const pad = value => String(value).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildLocalRecord(data) {
    const cycleNumber = parseInt(data.last_cycle || data.cycles || 0, 10) || 0;
    if (cycleNumber <= 0) return null;
    return {
        timestamp: formatLocalTimestamp(data.last_timestamp, cycleNumber),
        active_sec: parseFloat(data.last_active_sec || 0) || 0,
        idle_sec: parseFloat(data.last_idle_sec || 0) || 0,
        daily_cycles: cycleNumber,
        rtc_ok: data.rtc_ok,
        sd_ok: data.sd_ok,
        source: 'ESP32 Local'
    };
}

async function fetchLocalStatus() {
    try {
        const response = await fetchWithTimeout(ESP32_IP + '/', { cache: 'no-store' }, 3000);
        if (!response.ok) throw new Error('ESP32 status unavailable');
        localStatus = await response.json();
        localLatestRecord = buildLocalRecord(localStatus);
        updateLocalStatusOnDashboard();
        renderTable();
    } catch (e) {
        localStatus = null;
        localLatestRecord = null;
        renderTable();
    }
}

function updateLocalStatusOnDashboard() {
    if (!localStatus) return;

    const localCycles = parseInt(localStatus.cycles || 0, 10) || 0;
    const cloudMaxCycle = getCloudMaxCycle();
    const queuedRecords = parseInt(localStatus.queued_records || 0, 10) || 0;
    const timeOk = localStatus.time_ok === true || localStatus.time_ok === 'true';
    const tlsTimeOk = localStatus.tls_time_ok === true || localStatus.tls_time_ok === 'true';
    const mqttState = (localStatus.mqtt_state_text || 'offline').toString().replace(/_/g, ' ');
    const cyclesEl = document.getElementById('cyclesToday');
    const awsSpan = document.getElementById('awsStatusIndicator');
    const rtcSpan = document.getElementById('rtcStatusIndicator');
    const sdSpan = document.getElementById('sdStatusIndicator');
    const lastUpd = document.getElementById('lastUpdate');
    const recordCount = document.getElementById('recordCount');

    if (cyclesEl && localCycles > cloudMaxCycle) {
        cyclesEl.innerText = localCycles;
    }

    if (awsSpan) {
        const awsConnected = localStatus.aws_connected === true || localStatus.aws_connected === 'true';
        awsSpan.innerText = awsConnected ? 'AWS: Syncing' : `AWS: ${mqttState}`;
        awsSpan.style.color = awsConnected ? '#4CAF50' : '#f59e0b';
    }

    if (rtcSpan && localStatus.rtc_ok !== undefined) {
        const rtcOk = localStatus.rtc_ok === true || localStatus.rtc_ok === 'true';
        rtcSpan.innerText = rtcOk ? 'RTC: OK' : 'RTC: ERR';
        rtcSpan.style.color = rtcOk ? '#4CAF50' : '#ef4444';
    }

    if (sdSpan && localStatus.sd_ok !== undefined) {
        const sdOk = localStatus.sd_ok === true || localStatus.sd_ok === 'true';
        sdSpan.innerText = sdOk ? 'SD: OK' : 'SD: ERR';
        sdSpan.style.color = sdOk ? '#4CAF50' : '#ef4444';
    }

    if (lastUpd && !timeOk) {
        lastUpd.innerText = 'Waiting for RTC/NTP time';
    } else if (lastUpd && !tlsTimeOk) {
        lastUpd.innerText = 'Waiting for AWS TLS time';
    } else if (lastUpd && queuedRecords > 0) {
        lastUpd.innerText = `${queuedRecords} record(s) queued for AWS`;
    } else if (lastUpd && localCycles > cloudMaxCycle) {
        lastUpd.innerText = `Local cycle #${localCycles} waiting for AWS`;
    }

    if (recordCount && (localCycles > cloudMaxCycle || queuedRecords > 0)) {
        recordCount.innerText = `(${filteredData.length} AWS records, local #${localCycles}, queued ${queuedRecords})`;
    }
}

function logout() {
    localStorage.removeItem('hejaaz_id');
    localStorage.removeItem('hejaaz_code');
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    if (localStatusInterval) { clearInterval(localStatusInterval); localStatusInterval = null; }
    currentMachineId = '';
    currentPasscode = '';
    allData = [];
    filteredData = [];
    localStatus = null;
    localLatestRecord = null;
    location.reload();
}

// Listeners for filters
document.addEventListener('DOMContentLoaded', () => {
    const rangeSelect = document.getElementById('timeRange');
    const dateInput = document.getElementById('dateFilter');
    if (rangeSelect) rangeSelect.addEventListener('change', () => updateDashboard(true));
    if (dateInput) dateInput.addEventListener('change', () => updateDashboard(true));
});

function updateDashboard(resetPage = false) {
    const rangeSelect = document.getElementById('timeRange');
    const dateInput = document.getElementById('dateFilter');
    const range = rangeSelect ? rangeSelect.value : 'all';
    const selectedDate = dateInput ? dateInput.value : '';

    if (range === 'today') {
        filteredData = allData.filter(item => item.timestamp && item.timestamp.startsWith(selectedDate));
    } else {
        filteredData = [...allData];
    }

    filteredData.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    updateKPIs(filteredData);
    renderCharts(filteredData);
    if (resetPage) currentPage = 1;
    renderTable();
    updateLocalStatusOnDashboard();
}

function updateKPIs(data) {
    const totalActive = data.reduce((acc, curr) => acc + (parseFloat(curr.active_sec) || 0), 0);
    const totalIdle = data.reduce((acc, curr) => acc + (parseFloat(curr.idle_sec) || 0), 0);

    document.getElementById('cyclesToday').innerText = data.length;
    document.getElementById('totalActiveDay').innerText = formatTime(totalActive);
    document.getElementById('totalIdleDay').innerText = formatTime(totalIdle);
    document.getElementById('recordCount').innerText = `(${data.length} records)`;

    const awsSpan = document.getElementById('awsStatusIndicator');
    const rtcSpan = document.getElementById('rtcStatusIndicator');
    const sdSpan = document.getElementById('sdStatusIndicator');
    const lastUpd = document.getElementById('lastUpdate');

    if (allData.length > 0) {
        const latest = allData[allData.length - 1];
        if (awsSpan) { awsSpan.innerText = "AWS: ✔"; awsSpan.style.color = "#4CAF50"; }

        if (rtcSpan) {
            const rtcOk = latest.rtc_ok === true || latest.rtc_ok === "true" || latest.rtc_ok === 1 || latest.rtc_ok === undefined;
            rtcSpan.innerText = rtcOk ? "RTC: ✔" : "RTC: ❌";
            rtcSpan.style.color = rtcOk ? "#4CAF50" : "#ef4444";
        }

        if (sdSpan) {
            const sdOk = latest.sd_ok === true || latest.sd_ok === "true" || latest.sd_ok === 1 || latest.sd_ok === undefined;
            sdSpan.innerText = sdOk ? "SD: ✔" : "SD: ❌";
            sdSpan.style.color = sdOk ? "#4CAF50" : "#ef4444";
        }

        if (lastUpd && latest.timestamp) {
            lastUpd.innerText = "Last: " + latest.timestamp.replace('T', ' ');
        }
    } else {
        if (awsSpan) { awsSpan.innerText = "AWS: ✔"; awsSpan.style.color = "#4CAF50"; }
        if (rtcSpan) { rtcSpan.innerText = "RTC: --"; rtcSpan.style.color = "#ef4444"; }
        if (sdSpan) { sdSpan.innerText = "SD: --"; sdSpan.style.color = "#ef4444"; }
        if (lastUpd) { lastUpd.innerText = "No data yet"; }
    }
}

function formatTime(seconds) {
    if (seconds < 60) return seconds.toFixed(1) + "s";
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}m ${secs}s`;
    }
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function renderCharts(data) {
    const timelineEl = document.querySelector("#timelineChart");
    const ratioEl = document.querySelector("#ratioChart");

    if (data.length === 0) {
        if (timelineChart) { timelineChart.destroy(); timelineChart = null; }
        if (ratioChart) { ratioChart.destroy(); ratioChart = null; }
        if (timelineEl) timelineEl.innerHTML = '<div class="empty-chart">No cycle data</div>';
        if (ratioEl) ratioEl.innerHTML = '<div class="empty-chart">No cycle data</div>';
        return;
    }

    // Show only last 15 cycles for clean, readable chart
    const chartData = data.slice(-15);

    const categories = chartData.map(d => {
        let t = (d.timestamp || '').split('T');
        return t.length > 1 ? t[1] : t[0];
    });
    const actives = chartData.map(d => parseFloat(d.active_sec) || 0);

    const tlOptions = {
        series: [{ name: 'Active Duration (s)', data: actives }],
        chart: { type: 'bar', height: 280, toolbar: { show: false }, background: 'transparent' },
        colors: ['#00adb5'],
        plotOptions: { bar: { borderRadius: 4, dataLabels: { position: 'top' } } },
        xaxis: { categories: categories, labels: { style: { fontSize: '10px', colors: '#94a3b8' }, rotate: -45 } },
        theme: { mode: 'dark' },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        title: { text: 'Last ' + chartData.length + ' Cycles', style: { fontSize: '12px', color: '#64748b' } }
    };
    if (timelineChart) timelineChart.destroy();
    timelineChart = new ApexCharts(timelineEl, tlOptions);
    timelineChart.render();

    const tActive = data.reduce((a, b) => a + (parseFloat(b.active_sec) || 0), 0);
    const tIdle = data.reduce((a, b) => a + (parseFloat(b.idle_sec) || 0), 0);
    const ratioOptions = {
        series: [parseFloat(tActive.toFixed(1)), parseFloat(tIdle.toFixed(1))],
        chart: { type: 'donut', height: 280, background: 'transparent' },
        labels: ['Active Time', 'Idle Time'],
        colors: ['#00adb5', '#334155'],
        stroke: { show: false },
        theme: { mode: 'dark' },
        legend: { position: 'bottom' }
    };
    if (ratioChart) ratioChart.destroy();
    ratioChart = new ApexCharts(ratioEl, ratioOptions);
    ratioChart.render();
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = "";
    const cloudMaxCycle = getCloudMaxCycle();
    const displayData = [...filteredData];
    if (localLatestRecord && (parseInt(localLatestRecord.daily_cycles || 0, 10) || 0) > cloudMaxCycle) {
        displayData.push(localLatestRecord);
    }
    displayData.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const startIndex = (currentPage - 1) * rowsPerPage;
    const pageData = displayData.slice(startIndex, startIndex + rowsPerPage);

    if (pageData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">No records found for this date.</td></tr>`;
    } else {
        pageData.forEach(item => {
            tbody.innerHTML += `<tr>
                <td>${(item.timestamp || '').replace('T', ' ')}</td>
                <td>${parseFloat(item.active_sec || 0).toFixed(2)}s</td>
                <td>${parseFloat(item.idle_sec || 0).toFixed(1)}s</td>
                <td>#${item.daily_cycles || '-'}</td>
                <td><span class="source-badge">${item.source || 'AWS Cloud'}</span></td>
            </tr>`;
        });
    }

    const totalPages = Math.ceil(displayData.length / rowsPerPage) || 1;
    document.getElementById('pageInfo').innerText = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('btnPrev').disabled = currentPage === 1;
    document.getElementById('btnNext').disabled = currentPage === totalPages;
}

function prevPage() { if (currentPage > 1) { currentPage--; renderTable(); } }
function nextPage() {
    const hasLocalRow = localLatestRecord && ((parseInt(localLatestRecord.daily_cycles || 0, 10) || 0) > getCloudMaxCycle());
    const totalPages = Math.ceil((filteredData.length + (hasLocalRow ? 1 : 0)) / rowsPerPage) || 1;
    if (currentPage < totalPages) { currentPage++; renderTable(); }
}

// ==========================================
// EXCEL EXPORT (No RTC/SD columns)
// ==========================================
function downloadExcel() {
    if (filteredData.length === 0) {
        alert("No data to download for the selected date.");
        return;
    }

    const excelData = filteredData.map(item => ({
        "Date & Time": (item.timestamp || '').replace('T', ' '),
        "Active Duration (Seconds)": parseFloat(item.active_sec || 0).toFixed(2),
        "Idle Duration (Seconds)": parseFloat(item.idle_sec || 0).toFixed(1),
        "Cycle Number": item.daily_cycles || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Machine Logs");

    const rangeSelect = document.getElementById('timeRange');
    const dateInput = document.getElementById('dateFilter');
    let fileName = `Hejaaz_Logs_${currentMachineId}_`;
    if (rangeSelect && rangeSelect.value === 'today' && dateInput) {
        fileName += dateInput.value;
    } else {
        fileName += "All_History";
    }
    fileName += ".xlsx";
    XLSX.writeFile(wb, fileName);
}

// ==========================================
// MASTER RESET (Hidden behind logo)
// ==========================================
function toggleMasterReset() {
    const panel = document.getElementById('masterResetPanel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
}

async function executeMasterReset() {
    const code = document.getElementById('resetPasscode').value;
    const statusEl = document.getElementById('resetStatus');

    if (code !== '9361') {
        statusEl.style.display = 'block';
        statusEl.style.color = '#ef4444';
        statusEl.innerText = 'INCORRECT PASSCODE - ACCESS DENIED';
        return;
    }

    if (!confirm('WARNING: This will PERMANENTLY delete ALL machine data from AWS Cloud.\n\nThis action CANNOT be undone.\n\nAre you absolutely sure?')) {
        return;
    }

    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    if (localStatusInterval) { clearInterval(localStatusInterval); localStatusInterval = null; }

    statusEl.style.display = 'block';
    statusEl.style.color = '#f59e0b';
    statusEl.innerText = 'Wiping AWS data and resetting ESP32...';

    try {
        const cloudUrl = buildApiUrl({ action: 'master_reset' });
        const deviceUrl = `${ESP32_IP}/reset?code=${encodeURIComponent(code)}`;
        const [cloudResult, deviceResult] = await Promise.allSettled([
            fetchWithTimeout(cloudUrl, { cache: 'no-store' }, 15000),
            fetchWithTimeout(deviceUrl, { cache: 'no-store' }, 5000)
        ]);
        const cloudOk = cloudResult.status === 'fulfilled' && cloudResult.value.ok;
        const deviceOk = deviceResult.status === 'fulfilled' && deviceResult.value.ok;

        allData = [];
        filteredData = [];
        localStatus = null;
        localLatestRecord = null;
        updateDashboard(true);
        document.getElementById('cyclesToday').innerText = '0';
        document.getElementById('totalActiveDay').innerText = '0s';
        document.getElementById('totalIdleDay').innerText = '0s';
        document.getElementById('recordCount').innerText = '(0 records)';

        if (cloudOk && deviceOk) {
            statusEl.style.color = '#4CAF50';
            statusEl.innerText = 'Master reset complete. ESP32 will restart and next cycle will be #1.';
        } else if (cloudOk) {
            statusEl.style.color = '#f59e0b';
            statusEl.innerText = 'AWS data wiped. ESP32 local reset was not confirmed.';
        } else {
            statusEl.style.color = '#f59e0b';
            statusEl.innerText = 'Reset request sent, but AWS did not confirm deletion.';
        }

        setTimeout(() => {
            document.getElementById('masterResetPanel').style.display = 'none';
            statusEl.style.display = 'none';
            document.getElementById('resetPasscode').value = '';
            fetchData();
            fetchLocalStatus();
            refreshInterval = setInterval(fetchData, 5000);
            localStatusInterval = setInterval(fetchLocalStatus, 2000);
        }, 7000);
    } catch (e) {
        statusEl.style.color = '#ef4444';
        statusEl.innerText = 'Network Error: ' + e.message;
        allData = [];
        filteredData = [];
        localStatus = null;
        localLatestRecord = null;
        updateDashboard(true);
    }
}

// ==========================================
// FAN SCHEDULE (communicates with ESP32 WebServer)
// ==========================================
async function loadFanSchedule() {
    try {
        const resp = await fetchWithTimeout(ESP32_IP + '/getfan', {}, 3000);
        const data = await resp.json();
        document.getElementById('fanEnabled').checked = data.enabled;
        document.getElementById('fanStart').value = String(data.sh).padStart(2, '0') + ':' + String(data.sm).padStart(2, '0');
        document.getElementById('fanEnd').value = String(data.eh).padStart(2, '0') + ':' + String(data.em).padStart(2, '0');
    } catch (e) { console.log('ESP32 not reachable for fan schedule'); }
}

async function saveFanSchedule() {
    const enabled = document.getElementById('fanEnabled').checked ? '1' : '0';
    const start = document.getElementById('fanStart').value.split(':');
    const end = document.getElementById('fanEnd').value.split(':');
    const statusEl = document.getElementById('fanStatus');

    if (!start[0] || !end[0]) {
        showFanStatus('Please select time', '#ef4444');
        return;
    }

    try {
        await fetchWithTimeout(`${ESP32_IP}/setfan?enabled=${enabled}&sh=${start[0]}&sm=${start[1]}&eh=${end[0]}&em=${end[1]}`, {}, 3000);
        showFanStatus('Settings saved to EEPROM', '#4CAF50');
    } catch (e) {
        showFanStatus('Error: ESP32 unreachable', '#ef4444');
    }
}

function showFanStatus(msg, color) {
    const statusEl = document.getElementById('fanStatus');
    statusEl.innerText = msg;
    statusEl.style.color = color;
    statusEl.style.display = 'block';
    statusEl.className = 'save-message'; // Triggers animation

    // Reset after animation finishes
    setTimeout(() => {
        statusEl.style.display = 'none';
        statusEl.className = '';
    }, 3000);
}
