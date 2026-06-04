import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np

# Baseline 2000Q1
BASE = "2000-Q1"

def q_to_ts(q):
    return pd.Period(q, freq="Q").to_timestamp()

def rebase(s, base_date):
    base_ts = q_to_ts(base_date)
    if base_ts in s.index:
        b = s.loc[base_ts]
    else:
        b = s.asof(base_ts)
    
    print(f"Rebasing series at {base_date}: base value = {b}")
    return 100 * s / b

def generate_plot():
    df = pd.read_csv("processed_data.csv")
    df["date"] = pd.PeriodIndex(df["time"], freq="Q").to_timestamp()
    df = df.set_index("date")
    
    # Filter to start exactly from 2000Q1 as implied
    df = df[df.index >= "2000-01-01"]
    
    # Numeric columns
    numeric_cols = ["income", "wages", "pop", "cpi"]
    df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors='coerce')
    
    # Fill gaps
    df[numeric_cols] = df[numeric_cols].interpolate(method='time')
    
    # Calculations
    df["real_income_agg"] = df["income"] / df["cpi"]
    df["real_income_pc"]  = df["real_income_agg"] / df["pop"]
    df["real_wage_pc"]    = (df["wages"] / df["cpi"]) / df["pop"]

    # Rolling mean for extra smoothness (4 quarters)
    plot_data = pd.DataFrame({
        "Renta disponible per cápita": df["real_income_pc"],
        "Salario real per cápita": df["real_wage_pc"],
        "Renta disponible real agregada": df["real_income_agg"],
    })
    
    plot_data = plot_data.rolling(window=4, min_periods=1, center=True).mean()

    # Rebase to 2000-Q1
    plot_df = pd.DataFrame()
    for col in plot_data.columns:
        plot_df[col] = rebase(plot_data[col], BASE)

    plot_df = plot_df.dropna()

    # Plot
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(15, 8), dpi=140)

    colors = {
        "Renta disponible per cápita": "#0b3b6e",
        "Salario real per cápita": "#d04b3b",
        "Renta disponible real agregada": "#97b34a",
    }

    # Add a horizontal line at 100 for the baseline
    ax.axhline(100, color='black', lw=1, alpha=0.3, zorder=1)

    for col in ["Renta disponible per cápita", "Salario real per cápita", "Renta disponible real agregada"]:
        ax.plot(plot_df.index, plot_df[col], lw=3, color=colors[col], label=col, zorder=2)

    # Title and subtitle
    ax.set_title(
        "Renta disponible agregada y per cápita y salario real per cápita",
        loc="left",
        fontsize=20,
        pad=30,
        fontweight="bold"
    )

    ax.text(
        0.0, 1.02,
        "1er trimestre 2000 = nivel 100",
        transform=ax.transAxes,
        fontsize=12,
        color="gray"
    )

    # Styling
    ax.set_ylim(80, 180)
    ax.legend(frameon=False, ncol=3, loc="upper left", bbox_to_anchor=(0, 0.95), fontsize=12)
    
    # Remove spines
    for s in ["top", "right", "left"]:
        ax.spines[s].set_visible(False)
    
    ax.spines["bottom"].set_color("#cccccc")
    ax.spines["bottom"].set_linewidth(1)

    # Grid
    ax.grid(axis='x', visible=False)
    ax.grid(axis='y', color="#eeeeee", linestyle='-', linewidth=1)

    # Time Ticks
    ax.xaxis.set_major_locator(mdates.YearLocator(5))
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y Q1'))
    
    # Footer
    plt.figtext(0.01, 0.01, "Fuentes: Eurostat, Cálculos propios", fontsize=10, color="gray")

    plt.tight_layout()
    plt.savefig("replication.png")
    print(f"Plot saved to replication.png. Data range: {plot_df.index.min().year} to {plot_df.index.max().year}")
    print(f"Value at {BASE}:")
    print(plot_df.loc[q_to_ts(BASE)])

if __name__ == "__main__":
    generate_plot()
