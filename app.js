const state = {
  listings: [],
  filtered: [],
  selectedId: null,
  sortKey: "monthly_cash_flow",
  sortDirection: "desc",
  zipcode: "83642",
};

const rowsEl = document.querySelector("#listingRows");
const emptyStateEl = document.querySelector("#emptyState");
const detailPanelEl = document.querySelector("#detailPanel");
const searchInput = document.querySelector("#searchInput");
const typeFilter = document.querySelector("#typeFilter");
const cashFlowFilter = document.querySelector("#cashFlowFilter");
const maxPriceInput = document.querySelector("#maxPriceInput");
const reloadButton = document.querySelector("#reloadButton");
const zipcodeInput = document.querySelector("#zipcodeInput");
const pagesInput = document.querySelector("#pagesInput");
const searchButton = document.querySelector("#searchButton");
const searchStatus = document.querySelector("#searchStatus");
const locationLabel = document.querySelector("#locationLabel");
const csvLink = document.querySelector("#csvLink");
const progressPanel = document.querySelector("#progressPanel");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");
const mapGrid = document.querySelector("#mapGrid");
const userInput = document.querySelector("#userInput");
const saveSearchButton = document.querySelector("#saveSearchButton");
const savedSearchSelect = document.querySelector("#savedSearchSelect");

const assumptionControls = {
  rent_per_unit: document.querySelector("#rentPerUnitInput"),
  interest_rate: document.querySelector("#interestRateInput"),
  tax_rate_percent: document.querySelector("#taxRateInput"),
  insurance_rate_percent: document.querySelector("#insuranceRateInput"),
  vacancy_percent: document.querySelector("#vacancyInput"),
  maintenance_percent: document.querySelector("#maintenanceInput"),
  management_percent: document.querySelector("#managementInput"),
  capex_percent: document.querySelector("#capexInput"),
};

const assumptionOutputs = {
  interest_rate: document.querySelector("#interestRateValue"),
  tax_rate_percent: document.querySelector("#taxRateValue"),
  insurance_rate_percent: document.querySelector("#insuranceRateValue"),
  vacancy_percent: document.querySelector("#vacancyValue"),
  maintenance_percent: document.querySelector("#maintenanceValue"),
  management_percent: document.querySelector("#managementValue"),
  capex_percent: document.querySelector("#capexValue"),
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

function formatMoney(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  return `${currency.format(Number(value))}${suffix}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  return percent.format(Number(value) / 100);
}

function normalizeType(type) {
  if (!type) return "Unknown";
  return String(type)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function displayType(listing) {
  return listing.property_subtype || listing.home_type || "Unknown";
}

function listingId(listing) {
  return listing.zpid || listing.url || listing.address;
}

function getAssumptions() {
  return Object.fromEntries(
    Object.entries(assumptionControls).map(([key, control]) => [key, control.value])
  );
}

function assumptionParams() {
  return new URLSearchParams(getAssumptions());
}

function updateAssumptionOutputs() {
  for (const [key, output] of Object.entries(assumptionOutputs)) {
    output.textContent = `${assumptionControls[key].value}%`;
  }
}

function setProgress(visible, text = "", percentValue = 0) {
  progressPanel.hidden = !visible;
  progressText.textContent = text;
  progressBar.style.width = `${percentValue}%`;
}

function sortValue(listing, key) {
  if (key === "property_subtype") return displayType(listing).toLowerCase();
  const value = listing[key];
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.toLowerCase() : value;
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedType = typeFilter.value;
  const cashFlow = cashFlowFilter.value;
  const maxPrice = Number(maxPriceInput.value);

  state.filtered = state.listings.filter((listing) => {
    const haystack = [
      listing.address,
      listing.city,
      listing.state,
      listing.zipcode,
      listing.property_subtype,
      listing.home_type,
      listing.status,
      listing.price,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (query && !haystack.includes(query)) return false;
    if (selectedType && displayType(listing) !== selectedType) return false;
    if (cashFlow === "positive" && Number(listing.monthly_cash_flow) < 0) return false;
    if (cashFlow === "negative" && Number(listing.monthly_cash_flow) >= 0) return false;
    if (maxPrice && Number(listing.price) > maxPrice) return false;
    return true;
  });

  state.filtered.sort((a, b) => {
    const first = sortValue(a, state.sortKey);
    const second = sortValue(b, state.sortKey);
    if (first > second) return state.sortDirection === "asc" ? 1 : -1;
    if (first < second) return state.sortDirection === "asc" ? -1 : 1;
    return 0;
  });

  if (!state.filtered.some((listing) => listingId(listing) === state.selectedId)) {
    state.selectedId = state.filtered[0] ? listingId(state.filtered[0]) : null;
  }

  render();
}

function updateTypeFilter() {
  const selected = typeFilter.value;
  const types = [
    ...new Set(["Duplex", "Triplex", ...state.listings.map(displayType).filter(Boolean)]),
  ].sort();

  typeFilter.innerHTML = '<option value="">All</option>';
  for (const type of types) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = normalizeType(type);
    typeFilter.append(option);
  }
  typeFilter.value = types.includes(selected) ? selected : "";
}

function resetLocalFilters() {
  searchInput.value = "";
  typeFilter.value = "";
  cashFlowFilter.value = "";
  maxPriceInput.value = "";
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function renderStats() {
  const prices = state.filtered.map((listing) => Number(listing.price)).filter(Number.isFinite);
  const cashFlows = state.filtered.map((listing) => Number(listing.monthly_cash_flow)).filter(Number.isFinite);
  const returns = state.filtered.map((listing) => Number(listing.cash_on_cash_return)).filter(Number.isFinite);

  document.querySelector("#statCount").textContent = state.filtered.length.toLocaleString("en-US");
  document.querySelector("#statMedianPrice").textContent = formatMoney(median(prices));
  document.querySelector("#statBestCashFlow").textContent = cashFlows.length
    ? formatMoney(Math.max(...cashFlows), "/mo")
    : formatMoney(0, "/mo");
  document.querySelector("#statCashReturn").textContent = formatPercent(average(returns));
}

function renderRows() {
  rowsEl.innerHTML = "";
  emptyStateEl.hidden = state.filtered.length !== 0;

  for (const listing of state.filtered) {
    const row = document.createElement("tr");
    const id = listingId(listing);
    row.className = id === state.selectedId ? "selected" : "";
    row.tabIndex = 0;
    row.addEventListener("click", () => {
      state.selectedId = id;
      render();
    });

    const cashFlowClass = Number(listing.monthly_cash_flow) >= 0 ? "positive" : "negative";
    row.innerHTML = `
      <td class="address-cell">
        ${listing.address || "N/A"}
        <span class="subtext">${listing.status || "N/A"} · ${listing.city || "N/A"}, ${listing.state || "N/A"} ${listing.zipcode || ""}</span>
      </td>
      <td class="money">${formatMoney(listing.price)}</td>
      <td><span class="pill">${normalizeType(displayType(listing))}</span></td>
      <td class="number">${formatNumber(listing.beds)}</td>
      <td class="number">${formatNumber(listing.sqft)}</td>
      <td class="money">${formatMoney(listing.price_per_sqft)}</td>
      <td class="money">${formatMoney(listing.total_actual_rent, "/mo")}</td>
      <td class="money">${formatMoney(listing.annual_property_tax, "/yr")}</td>
      <td class="${cashFlowClass} money">${formatMoney(listing.monthly_cash_flow, "/mo")}</td>
      <td class="number">${formatPercent(listing.cash_on_cash_return)}</td>
    `;
    rowsEl.append(row);
  }
}

function metric(label, value, className = "") {
  return `<div class="metric"><span>${label}</span><strong class="${className}">${value}</strong></div>`;
}

function renderDetail() {
  const listing = state.filtered.find((item) => listingId(item) === state.selectedId);
  if (!listing) {
    detailPanelEl.innerHTML = '<div class="detail-head"><h2>No property selected</h2></div>';
    return;
  }

  const cashFlowClass = Number(listing.monthly_cash_flow) >= 0 ? "positive" : "negative";
  const mapUrl = listing.latitude && listing.longitude
    ? `https://www.openstreetmap.org/?mlat=${listing.latitude}&mlon=${listing.longitude}#map=16/${listing.latitude}/${listing.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.address || "")}`;

  detailPanelEl.innerHTML = `
    <div class="detail-head">
      <h2>${listing.address || "N/A"}</h2>
      <a class="detail-link" href="${listing.url}" target="_blank" rel="noreferrer">Open on Zillow</a>
      <br>
      <a class="detail-link" href="${mapUrl}" target="_blank" rel="noreferrer">Open map</a>
    </div>
    <div class="detail-grid">
      ${metric("Price", formatMoney(listing.price))}
      ${metric("Cash Flow", formatMoney(listing.monthly_cash_flow, "/mo"), cashFlowClass)}
      ${metric("Total Actual Rent", formatMoney(listing.total_actual_rent ?? listing.monthly_rent, "/mo"))}
      ${metric("Price / Sq Ft", formatMoney(listing.price_per_sqft))}
      ${metric("Property Tax", formatMoney(listing.annual_property_tax, "/yr"))}
      ${metric("Monthly Expenses", formatMoney(listing.monthly_expenses, "/mo"))}
      ${metric("Mortgage P&I", formatMoney(listing.monthly_mortgage_pi, "/mo"))}
      ${metric("NOI", formatMoney(listing.monthly_noi, "/mo"))}
      ${metric("Down Payment", formatMoney(listing.down_payment))}
      ${metric("Cash-on-Cash", formatPercent(listing.cash_on_cash_return))}
      ${metric("Beds / Baths", `${formatNumber(listing.beds)} / ${formatNumber(listing.baths)}`)}
      ${metric("Sq Ft", formatNumber(listing.sqft))}
      ${metric("Type", normalizeType(displayType(listing)))}
      ${metric("Units", formatNumber(listing.units))}
    </div>
  `;
}

function renderMap() {
  mapGrid.innerHTML = "";
  const items = state.filtered.slice(0, 24);
  for (const listing of items) {
    const card = document.createElement("div");
    card.className = "map-card";
    const mapUrl = listing.latitude && listing.longitude
      ? `https://www.openstreetmap.org/?mlat=${listing.latitude}&mlon=${listing.longitude}#map=16/${listing.latitude}/${listing.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.address || "")}`;
    card.innerHTML = `
      <strong>${listing.address || "N/A"}</strong>
      <span class="subtext">${formatMoney(listing.price)} · ${normalizeType(displayType(listing))}</span>
      <a href="${mapUrl}" target="_blank" rel="noreferrer">Open map</a>
    `;
    mapGrid.append(card);
  }
}

function render() {
  renderStats();
  renderRows();
  renderDetail();
  renderMap();
}

async function loadListings() {
  reloadButton.disabled = true;
  try {
    const response = await fetch(`zillow_cash_flow.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error(`Could not load data: ${response.status}`);
    state.listings = await response.json();
    if (state.listings[0]?.zipcode) {
      state.zipcode = state.listings[0].zipcode;
      zipcodeInput.value = state.zipcode;
      locationLabel.textContent = `ZIP ${state.zipcode}`;
    }
    if (state.listings.length > 41) {
      pagesInput.value = "5";
    }
    state.selectedId = state.listings[0] ? listingId(state.listings[0]) : null;
    updateTypeFilter();
    applyFilters();
  } catch (error) {
    rowsEl.innerHTML = "";
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = error.message;
  } finally {
    reloadButton.disabled = false;
  }
}

async function searchZipcode({ refresh = false } = {}) {
  const zipcode = zipcodeInput.value.trim();
  const pages = pagesInput.value || "1";
  if (!/^\d{5}$/.test(zipcode)) {
    searchStatus.textContent = "Enter a valid 5-digit ZIP code.";
    zipcodeInput.focus();
    return;
  }

  searchButton.disabled = true;
  reloadButton.disabled = true;
  setProgress(true, refresh ? "Refreshing Zillow data..." : "Checking cache and assumptions...", 20);
  rowsEl.innerHTML = "";
  emptyStateEl.hidden = false;
  emptyStateEl.textContent = "Loading results...";

  try {
    const params = assumptionParams();
    params.set("zipcode", zipcode);
    params.set("pages", pages);
    params.set("refresh", String(refresh));
    setProgress(true, "Searching and calculating cash flow...", 65);
    const response = await fetch(`/api/search?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Search failed: ${response.status}`);

    state.zipcode = payload.zipcode;
    state.listings = payload.listings || [];
    state.selectedId = state.listings[0] ? listingId(state.listings[0]) : null;
    locationLabel.textContent = `ZIP ${state.zipcode}`;
    csvLink.href = `zillow_cash_flow.csv?ts=${Date.now()}`;
    searchStatus.textContent = `Found ${payload.count} properties in ZIP ${state.zipcode}${payload.cache_hit ? " from cache" : ""}.`;
    updateTypeFilter();
    resetLocalFilters();
    setProgress(true, "Rendering dashboard...", 95);
    applyFilters();
    setTimeout(() => setProgress(false), 500);
  } catch (error) {
    state.listings = [];
    state.filtered = [];
    render();
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = error.message;
    searchStatus.textContent = error.message;
    setProgress(false);
  } finally {
    searchButton.disabled = false;
    reloadButton.disabled = false;
  }
}

async function saveCurrentSearch() {
  const zipcode = zipcodeInput.value.trim();
  if (!/^\d{5}$/.test(zipcode)) return;
  const params = assumptionParams();
  params.set("zipcode", zipcode);
  params.set("pages", pagesInput.value || "1");
  params.set("user", userInput.value.trim() || "guest");
  const response = await fetch(`/api/save-search?${params.toString()}`);
  const payload = await response.json();
  searchStatus.textContent = response.ok ? `Saved search #${payload.id}.` : payload.error;
  await loadSavedSearches();
}

async function loadSavedSearches() {
  const user = userInput.value.trim() || "guest";
  const response = await fetch(`/api/saved-searches?user=${encodeURIComponent(user)}`);
  const payload = await response.json();
  savedSearchSelect.innerHTML = '<option value="">Saved searches</option>';
  for (const saved of payload.saved_searches || []) {
    const option = document.createElement("option");
    option.value = JSON.stringify(saved);
    option.textContent = `${saved.zipcode} · ${new Date(saved.created_at * 1000).toLocaleString()}`;
    savedSearchSelect.append(option);
  }
}

document.querySelectorAll("[data-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.sortKey === key) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDirection = key === "address" || key === "property_subtype" ? "asc" : "desc";
    }
    applyFilters();
  });
});

[searchInput, typeFilter, cashFlowFilter, maxPriceInput].forEach((control) => {
  control.addEventListener("input", applyFilters);
});

Object.values(assumptionControls).forEach((control) => {
  control.addEventListener("input", updateAssumptionOutputs);
});

reloadButton.addEventListener("click", () => searchZipcode({ refresh: true }));
searchButton.addEventListener("click", () => searchZipcode());
saveSearchButton.addEventListener("click", saveCurrentSearch);
userInput.addEventListener("change", loadSavedSearches);
savedSearchSelect.addEventListener("change", () => {
  if (!savedSearchSelect.value) return;
  const saved = JSON.parse(savedSearchSelect.value);
  zipcodeInput.value = saved.zipcode;
  pagesInput.value = saved.pages;
  for (const [key, value] of Object.entries(saved.assumptions || {})) {
    if (assumptionControls[key] && value !== "") assumptionControls[key].value = value;
  }
  updateAssumptionOutputs();
  searchZipcode();
});
zipcodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchZipcode();
});

updateAssumptionOutputs();
loadListings();
loadSavedSearches();
