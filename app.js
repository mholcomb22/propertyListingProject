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
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return `${currency.format(Number(value))}${suffix}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
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

function sortValue(listing, key) {
  if (key === "property_subtype") {
    return displayType(listing).toLowerCase();
  }
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
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        state.selectedId = id;
        render();
      }
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
      <td class="${cashFlowClass} money">${formatMoney(listing.monthly_cash_flow, "/mo")}</td>
      <td class="number">${formatPercent(listing.cash_on_cash_return)}</td>
    `;
    rowsEl.append(row);
  }
}

function metric(label, value, className = "") {
  return `
    <div class="metric">
      <span>${label}</span>
      <strong class="${className}">${value}</strong>
    </div>
  `;
}

function renderDetail() {
  const listing = state.filtered.find((item) => listingId(item) === state.selectedId);
  if (!listing) {
    detailPanelEl.innerHTML = `
      <div class="detail-head">
        <h2>No property selected</h2>
      </div>
    `;
    return;
  }

  const cashFlowClass = Number(listing.monthly_cash_flow) >= 0 ? "positive" : "negative";
  detailPanelEl.innerHTML = `
    <div class="detail-head">
      <h2>${listing.address || "N/A"}</h2>
      <a class="detail-link" href="${listing.url}" target="_blank" rel="noreferrer">Open on Zillow</a>
    </div>
    <div class="detail-grid">
      ${metric("Price", formatMoney(listing.price))}
      ${metric("Cash Flow", formatMoney(listing.monthly_cash_flow, "/mo"), cashFlowClass)}
      ${metric("Monthly Rent", formatMoney(listing.monthly_rent, "/mo"))}
      ${metric("Monthly Expenses", formatMoney(listing.monthly_expenses, "/mo"))}
      ${metric("Mortgage P&I", formatMoney(listing.monthly_mortgage_pi, "/mo"))}
      ${metric("NOI", formatMoney(listing.monthly_noi, "/mo"))}
      ${metric("Down Payment", formatMoney(listing.down_payment))}
      ${metric("Cash-on-Cash", formatPercent(listing.cash_on_cash_return))}
      ${metric("Beds / Baths", `${formatNumber(listing.beds)} / ${formatNumber(listing.baths)}`)}
      ${metric("Sq Ft", formatNumber(listing.sqft))}
      ${metric("Type", normalizeType(displayType(listing)))}
      ${metric("Units", formatNumber(listing.units))}
      ${metric("ZPID", listing.zpid || "N/A")}
    </div>
  `;
}

function render() {
  renderStats();
  renderRows();
  renderDetail();
}

async function loadListings() {
  reloadButton.disabled = true;
  try {
    const response = await fetch(`zillow_cash_flow.json?ts=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Could not load data: ${response.status}`);
    }
    state.listings = await response.json();
    if (state.listings[0]?.zipcode) {
      state.zipcode = state.listings[0].zipcode;
      zipcodeInput.value = state.zipcode;
      locationLabel.textContent = `ZIP ${state.zipcode}`;
    }
    state.selectedId = state.listings[0] ? listingId(state.listings[0]) : null;
    updateTypeFilter();
    applyFilters();
  } catch (error) {
    rowsEl.innerHTML = "";
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = error.message;
    detailPanelEl.innerHTML = `
      <div class="detail-head">
        <h2>Data unavailable</h2>
      </div>
    `;
  } finally {
    reloadButton.disabled = false;
  }
}

async function searchZipcode() {
  const zipcode = zipcodeInput.value.trim();
  const pages = pagesInput.value || "1";
  if (!/^\d{5}$/.test(zipcode)) {
    searchStatus.textContent = "Enter a valid 5-digit ZIP code.";
    zipcodeInput.focus();
    return;
  }

  searchButton.disabled = true;
  reloadButton.disabled = true;
  searchStatus.textContent = `Searching ZIP ${zipcode} for properties...`;
  rowsEl.innerHTML = "";
  emptyStateEl.hidden = false;
  emptyStateEl.textContent = "Searching Zillow...";

  try {
    const response = await fetch(`/api/search?zipcode=${encodeURIComponent(zipcode)}&pages=${encodeURIComponent(pages)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Search failed: ${response.status}`);
    }

    state.zipcode = payload.zipcode;
    state.listings = payload.listings || [];
    state.selectedId = state.listings[0] ? listingId(state.listings[0]) : null;
    locationLabel.textContent = `ZIP ${state.zipcode}`;
    csvLink.href = `zillow_cash_flow.csv?ts=${Date.now()}`;
    searchStatus.textContent = `Found ${payload.count} properties in ZIP ${state.zipcode}.`;
    updateTypeFilter();
    resetLocalFilters();
    applyFilters();
  } catch (error) {
    state.listings = [];
    state.filtered = [];
    render();
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = error.message;
    searchStatus.textContent = error.message;
  } finally {
    searchButton.disabled = false;
    reloadButton.disabled = false;
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

reloadButton.addEventListener("click", searchZipcode);
searchButton.addEventListener("click", searchZipcode);
zipcodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchZipcode();
  }
});

loadListings();
