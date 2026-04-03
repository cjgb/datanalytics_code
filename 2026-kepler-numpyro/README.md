# Kepler meets Bayes

This project performs a Bayesian estimation of the Earth's orbit eccentricity using modern NASA ephemeris data and the `NumPyro` probabilistic programming library. It aims to reproduce and extend Johannes Kepler's historical work by quantifying the uncertainty in his point estimates.

## Overview

Johannes Kepler estimated the Earth's orbital eccentricity to be approximately 0.017, which is remarkably close to the modern value of 0.0167. This project uses Bayesian analysis to:

1. **Estimate the eccentricity** and other orbital parameters (inclination `omega` and Mars' position) from ecliptic longitude data.
2. **Quantify uncertainty** by modeling noise in observations, providing a distribution of possible values rather than just a single point estimate.

The analysis is based on a dataset of 11 observations where Mars returns to the same spot in its orbit (every 687 days), a technique famously used by Kepler.

## Project Structure

- `estimate_earth_orbit.ipynb`: The primary Jupyter notebook containing the data processing, Bayesian model definition, and results visualization.
- `ephemeris_mars_sun.csv`: NASA ephemeris data for Mars and the Sun, sourced from [Luca Canali's repository](https://github.com/LucaCanali/Miscellaneous/blob/master/Data_Analyses/Kepler/Data/ephemeris_mars_sun.csv).
- `img/`: Directory containing visualizations and diagrams related to the project.

## Requirements

- Python >= 3.13
- Dependencies managed via `uv`:
  - `numpyro`: For Bayesian modeling and MCMC.
  - `arviz`: For exploratory analysis of Bayesian models.
  - `pandas`: For data manipulation.
  - `numpy` & `scipy`: For numerical computations.
  - `matplotlib`: For visualization.

## Getting Started

This project uses [uv](https://github.com/astral-sh/uv) for fast and reliable dependency management.

To install the dependencies, run

```bash
uv sync
```

Then you can rerun the notebook with your favourite tool.

## Acknowledgments

- Data provided by [Luca Canali](https://github.com/LucaCanali), who extracted and curated the NASA ephemeris data.
- Johannes Kepler and Tycho Brahe for their foundational work in celestial mechanics.
