// ==========================================
// HEJAAZ TECH - Multi-Device Secure Dashboard
// ==========================================
const BASE_API_URL = "https://umrlwzymt3ekunadrnpngatydy0ubhrx.lambda-url.us-east-1.on.aws/";
let allData = [];
let filteredData = [];
let timelineChart, ratioChart;
let refreshInterval;
let currentPage = 1;
const rowsPerPage = 15;

// Auth State
let currentMachineId = "";
let currentPasscode = "";

document.addEventListener('DOMContentLoaded', () => {
    // Get local date properly
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    
    const dateInput = document.getElementById('dateFilter');
    if (dateInput) dateInput.value = today;

    // DO NOT auto-fill saved credentials — force fresh login each time
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
        errorMsg.innerText = success; // Display the actual AWS error message
        errorMsg.style.display = "block";
    } else if (success === true) {
        // Save for next time
        localStorage.setItem('hejaaz_id', id);
        localStorage.setItem('hejaaz_code', code);
        
        // Switch UI
        document.getElementById('loginOverlay').classList.add('hidden');
        document.getElementById('mainDashboard').style.display = "block";
        document.getElementById('activeMachineName').innerHTML = `MACHINE: <span>${id}</span>`;
        
        // Start auto-refresh
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(fetchData, 5000);
    } else {
        btn.innerText = "Connect to AWS";
        btn.disabled = false;
        errorMsg.innerText = "Connection Failed. Please try again.";
        errorMsg.style.display = "block";
    }
}

async function fetchData() {
    const url = `${BASE_API_URL}?id=${encodeURIComponent(currentMachineId)}&code=${encodeURIComponent(currentPasscode)}`;
    const refreshBtn = document.querySelector('.btn-refresh');
    if(refreshBtn) refreshBtn.innerText = "↻ Syncing...";
    
    try {
        const response = await fetch(url);
        
        if (response.status === 401 || response.status === 500) {
            const errorData = await response.json();
            if(refreshBtn) refreshBtn.innerText = "↻ Refresh";
            return errorData.error || "Authentication Failed";
        }
        
        if (!response.ok) throw new Error("Network Error");
        
        allData = await response.json();
        updateDashboard(false); // Do not reset page when auto-syncing
        if(refreshBtn) refreshBtn.innerText = "✓ Synced";
        setTimeout(() => { if(refreshBtn) refreshBtn.innerText = "↻ Refresh"; }, 2000);
        return true;
    } catch (e) {
        console.error("Fetch Error:", e);
        if(refreshBtn) refreshBtn.innerText = "⚠ Error";
        setTimeout(() => { if(refreshBtn) refreshBtn.innerText = "↻ Refresh"; }, 2000);
        return false;
    }
}

function logout() {
    localStorage.removeItem('hejaaz_id');
    localStorage.removeItem('hejaaz_code');
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    currentMachineId = '';
    currentPasscode = '';
    allData = [];
    filteredData = [];
    location.reload();
}

// --- Dashboard Logic (Same as before but filtered by auth) ---

// Listeners for filters (when user clicks these, we DO want to reset to page 1)
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
    const now = new Date();

    if (range === 'today') {
        filteredData = allData.filter(item => item.timestamp && item.timestamp.startsWith(selectedDate));
    } else {
        filteredData = [...allData];
    }

    filteredData.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    updateKPIs(filteredData);
    renderCharts(filteredData);
    
    // Only jump back to Page 1 if the user changed the filter
    if (resetPage) {
        currentPage = 1;
    }
    
    renderTable();
}

function updateKPIs(data) {
    const totalActive = data.reduce((acc, curr) => acc + (parseFloat(curr.active_sec) || 0), 0);
    const totalIdle = data.reduce((acc, curr) => acc + (parseFloat(curr.idle_sec) || 0), 0);
    
    // Show number of cycles in filtered view (actual record count)
    document.getElementById('cyclesToday').innerText = data.length;
    document.getElementById('totalActiveDay').innerText = formatTime(totalActive);
    document.getElementById('totalIdleDay').innerText = formatTime(totalIdle);
    document.getElementById('recordCount').innerText = `(${data.length} records)`;

    // Hardware Status (from latest record)
    const awsSpan = document.getElementById('awsStatusIndicator');
    const rtcSpan = document.getElementById('rtcStatusIndicator');
    const sdSpan = document.getElementById('sdStatusIndicator');
    const lastUpd = document.getElementById('lastUpdate');

    if (allData.length > 0) {
        const latest = allData[allData.length - 1];
        
        // AWS is OK if we got data
        if(awsSpan) { awsSpan.innerText = "AWS: ✔"; awsSpan.style.color = "#4CAF50"; }
        
        // RTC: if field exists, use it. If missing (old record), assume OK
        if(rtcSpan) { 
            if (latest.hasOwnProperty('rtc_ok')) {
                const rtcOk = latest.rtc_ok === true || latest.rtc_ok === "true" || latest.rtc_ok === 1;
                rtcSpan.innerText = rtcOk ? "RTC: ✔" : "RTC: ⚠";
                rtcSpan.style.color = rtcOk ? "#4CAF50" : "#f59e0b";
            } else {
                rtcSpan.innerText = "RTC: ✔";
                rtcSpan.style.color = "#4CAF50";
            }
        }
        
        // SD: if field exists, use it. If missing (old record), assume OK
        if(sdSpan) {
            if (latest.hasOwnProperty('sd_ok')) {
                const sdOk = latest.sd_ok === true || latest.sd_ok === "true" || latest.sd_ok === 1;
                sdSpan.innerText = sdOk ? "SD: ✔" : "SD: ❌";
                sdSpan.style.color = sdOk ? "#4CAF50" : "#ef4444";
            } else {
                sdSpan.innerText = "SD: ✔";
                sdSpan.style.color = "#4CAF50";
            }
        }
        
        if(lastUpd && latest.timestamp) {
            lastUpd.innerText = "Last: " + latest.timestamp.replace('T', ' ');
        }
    } else {
        // No data at all
        if(awsSpan) { awsSpan.innerText = "AWS: ✔"; awsSpan.style.color = "#4CAF50"; }
        if(rtcSpan) { rtcSpan.innerText = "RTC: ✔"; rtcSpan.style.color = "#4CAF50"; }
        if(sdSpan) { sdSpan.innerText = "SD: ✔"; sdSpan.style.color = "#4CAF50"; }
        if(lastUpd) { lastUpd.innerText = "No data yet"; }
    }
}

function formatTime(seconds) {
    if (seconds < 60) return seconds.toFixed(1) + "s";
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}m ${secs}s`;
    }
    return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
}

function renderCharts(data) {
    if (data.length === 0) return;

    const categories = data.map(d => {
        let t = (d.timestamp || '').split('T');
        return t.length > 1 ? t[1] : t[0];
    });
    const actives = data.map(d => parseFloat(d.active_sec) || 0);

    // Timeline
    const tlOptions = {
        series: [{ name: 'Active Duration (s)', data: actives }],
        chart: { type: 'bar', height: 280, toolbar: { show: false }, background: 'transparent' },
        colors: ['#00adb5'],
        plotOptions: { bar: { borderRadius: 4, dataLabels: { position: 'top' } } },
        xaxis: { categories: categories, labels: { show: false } },
        theme: { mode: 'dark' },
        grid: { borderColor: 'rgba(255,255,255,0.05)' }
    };
    if (timelineChart) timelineChart.destroy();
    timelineChart = new ApexCharts(document.querySelector("#timelineChart"), tlOptions);
    timelineChart.render();

    // Ratio
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
    ratioChart = new ApexCharts(document.querySelector("#ratioChart"), ratioOptions);
    ratioChart.render();
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = "";
    
    // Sort descending by timestamp so newest is on top
    const displayData = [...filteredData].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    
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
                <td><span class="source-badge">AWS Cloud</span></td>
            </tr>`;
        });
    }
    
    const totalPages = Math.ceil(displayData.length / rowsPerPage) || 1;
    document.getElementById('pageInfo').innerText = `Page ${currentPage} of ${totalPages}`;
    
    // Disable/Enable buttons
    document.getElementById('btnPrev').disabled = currentPage === 1;
    document.getElementById('btnNext').disabled = currentPage === totalPages;
}

function prevPage() { if (currentPage > 1) { currentPage--; renderTable(); } }
function nextPage() { 
    const totalPages = Math.ceil(filteredData.length / rowsPerPage) || 1;
    if (currentPage < totalPages) { currentPage++; renderTable(); } 
}

// ==========================================
// EXCEL EXPORT
// ==========================================
function downloadExcel() {
    if (filteredData.length === 0) {
        alert("No data to download for the selected date.");
        return;
    }

    // Prepare data for Excel
    const excelData = filteredData.map(item => ({
        "Date & Time": (item.timestamp || '').replace('T', ' '),
        "Active Duration (Seconds)": parseFloat(item.active_sec || 0).toFixed(2),
        "Idle Duration (Seconds)": parseFloat(item.idle_sec || 0).toFixed(1),
        "Cycle Number": item.daily_cycles || '-',
        "Hardware Status": `SD: ${item.sd_ok !== false ? 'OK' : 'FAIL'} | RTC: ${item.rtc_ok !== false ? 'OK' : 'FAIL'}`
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Machine Logs");

    // Generate filename based on filter
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

    if (!confirm('⚠ WARNING: This will PERMANENTLY delete ALL machine data from AWS Cloud.\n\nThis action CANNOT be undone.\n\nAre you absolutely sure?')) {
        return;
    }

    // Stop auto-refresh so old data doesn't reload
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }

    statusEl.style.display = 'block';
    statusEl.style.color = '#f59e0b';
    statusEl.innerText = 'Wiping data from AWS...';

    try {
        // Use GET with action parameter
        const url = `${BASE_API_URL}?id=${encodeURIComponent(currentMachineId)}&code=${encodeURIComponent(currentPasscode)}&action=master_reset`;
        const response = await fetch(url);

        // Clear dashboard immediately
        allData = [];
        filteredData = [];
        updateDashboard(true);
        document.getElementById('cyclesToday').innerText = '0';
        document.getElementById('totalActiveDay').innerText = '0s';
        document.getElementById('totalIdleDay').innerText = '0s';
        document.getElementById('recordCount').innerText = '(0 records)';

        if (response.ok) {
            statusEl.style.color = '#4CAF50';
            statusEl.innerText = '✓ ALL DATA WIPED SUCCESSFULLY! Restart the dashboard to verify.';
        } else {
            statusEl.style.color = '#f59e0b';
            statusEl.innerText = 'AWS delete may not be supported. Update your Lambda function (see instructions).';
        }

        setTimeout(() => {
            document.getElementById('masterResetPanel').style.display = 'none';
            statusEl.style.display = 'none';
            document.getElementById('resetPasscode').value = '';
        }, 5000);
    } catch (e) {
        statusEl.style.color = '#ef4444';
        statusEl.innerText = 'Network Error: ' + e.message;
        allData = [];
        filteredData = [];
        updateDashboard(true);
    }
}
