import pandas as pd
import eurostat
import numpy as np

COUNTRY = "ES"

def fetch_and_melt(dataset_code):
    print(f"Fetching {dataset_code}...")
    df = eurostat.get_data_df(dataset_code, flags=False)
    
    # Handle the weird 'geo\\TIME_PERIOD' or similar columns
    geo_col = None
    for col in df.columns:
        if "geo" in col:
            geo_col = col
            break
    
    if geo_col is None:
        raise ValueError(f"Could not find geo column in {dataset_code}")

    # Metadata columns usually don't have digits (mostly)
    id_vars = [col for col in df.columns if not any(char.isdigit() for char in col)]
    if geo_col not in id_vars:
        id_vars.append(geo_col)
    
    melted = df.melt(id_vars=id_vars, var_name="time", value_name="value")
    melted = melted.rename(columns={geo_col: "geo"})
    
    return melted

def standardize_time(df):
    # Ensure time is in YYYY-QX format
    df = df.copy()
    # Normalize formats like 2025Q1 or 2025-Q1 to 2025-Q1
    df["time"] = df["time"].astype(str).str.replace(r"(\d{4})Q(\d)", r"\1-Q\2", regex=True)
    return df

def process_data():
    # 1. Income (nasq_10_nf_tr)
    income_raw = fetch_and_melt("nasq_10_nf_tr")
    income_es = income_raw[
        (income_raw["geo"] == COUNTRY) & 
        (income_raw["na_item"] == "B6G") & 
        (income_raw["sector"] == "S14_S15") &
        (income_raw["unit"] == "CP_MEUR")
    ].copy()
    
    if "s_adj" in income_es.columns:
        # Prefer SCA for smoothing
        sadj = "SCA" if "SCA" in income_es["s_adj"].values else income_es["s_adj"].unique()[0]
        income = income_es[income_es["s_adj"] == sadj].copy()
    else:
        income = income_es.copy()

    income = income.rename(columns={"value": "income"})[["time", "income"]]
    income = standardize_time(income)

    # 2. Wages (namq_10_gdp)
    gdp_raw = fetch_and_melt("namq_10_gdp")
    gdp_es = gdp_raw[
        (gdp_raw["geo"] == COUNTRY) & 
        (gdp_raw["na_item"] == "D1") & 
        (gdp_raw["unit"] == "CP_MEUR")
    ].copy()
    
    if "s_adj" in gdp_es.columns:
        # Prefer SCA for smoothing
        sadj = "SCA" if "SCA" in gdp_es["s_adj"].values else gdp_es["s_adj"].unique()[0]
        wages = gdp_es[gdp_es["s_adj"] == sadj].copy()
    else:
        wages = gdp_es.copy()

    wages = wages.rename(columns={"value": "wages"})[["time", "wages"]]
    wages = standardize_time(wages)
    
    # 3. Population (namq_10_pe)
    try:
        pop_raw = fetch_and_melt("namq_10_pe")
        pop_es = pop_raw[
            (pop_raw["geo"] == COUNTRY) & 
            (pop_raw["na_item"] == "POP_NC") &
            (pop_raw["unit"] == "THS_PER")
        ].copy()
        
        if "s_adj" in pop_es.columns:
            # Prefer SCA for smoothing
            sadj = "SCA" if "SCA" in pop_es["s_adj"].values else pop_es["s_adj"].unique()[0]
            pop = pop_es[pop_es["s_adj"] == sadj].copy()
        else:
            pop = pop_es.copy()
            
        pop["pop"] = pop["value"].astype(float) * 1000
        pop = pop[["time", "pop"]]
        pop = standardize_time(pop)
    except Exception as e:
        print(f"Error fetching population: {e}")
        pop = pd.DataFrame(columns=["time", "pop"])

    # 4. CPI (prc_hicp_midx)
    cpi_raw = fetch_and_melt("prc_hicp_midx")
    cpi_es_raw = cpi_raw[
        (cpi_raw["geo"] == COUNTRY) & 
        (cpi_raw["coicop"] == "CP00")
    ]
    
    if "I15" in cpi_es_raw["unit"].values:
        unit = "I15"
    elif "I05" in cpi_es_raw["unit"].values:
        unit = "I05"
    else:
        unit = cpi_es_raw["unit"].unique()[0]
    
    cpi_es = cpi_es_raw[cpi_es_raw["unit"] == unit].copy()
    cpi_es["date"] = pd.to_datetime(cpi_es["time"], errors='coerce')
    cpi_es = cpi_es.dropna(subset=["date"])
    cpi_es = cpi_es.set_index("date")["value"].astype(float).resample("QE").mean().reset_index()
    cpi_es["time"] = cpi_es["date"].dt.to_period("Q").astype(str)
    cpi = cpi_es.rename(columns={"value": "cpi"})[["time", "cpi"]]
    cpi = standardize_time(cpi)

    # Merge
    income = income.drop_duplicates("time")
    wages = wages.drop_duplicates("time")
    pop = pop.drop_duplicates("time")
    cpi = cpi.drop_duplicates("time")

    df = income.merge(wages, on="time", how="outer")
    df = df.merge(pop, on="time", how="outer")
    df = df.merge(cpi, on="time", how="outer")
    
    df = df.sort_values("time")
    df.to_csv("processed_data.csv", index=False)
    print(f"Saved processed_data.csv with {len(df)} rows.")

if __name__ == "__main__":
    process_data()
