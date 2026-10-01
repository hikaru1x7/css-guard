#!/usr/bin/env python3
import argparse, json, math, sys
p=argparse.ArgumentParser(description="Check actual control centers from GUI measurements")
p.add_argument("measurement");p.add_argument("first");p.add_argument("second")
p.add_argument("--axis",choices=("x","y"),default="y");p.add_argument("--tolerance",type=float,default=0)
a=p.parse_args()
if not math.isfinite(a.tolerance) or a.tolerance<0:p.error("tolerance must be finite and nonnegative")
data=json.load(open(a.measurement,encoding="utf-8-sig"))
rows={row["name"]:row for row in data["controls"]}
if len(rows)!=len(data["controls"]):p.error("duplicate named control")
try:
    key="centerX" if a.axis=="x" else "centerY"
    first=float(rows[a.first][key]);second=float(rows[a.second][key])
except KeyError as e:p.error("measurement or named control missing: "+str(e))
if not math.isfinite(first) or not math.isfinite(second):p.error("centers must be finite")
delta=abs(first-second)
print(json.dumps({"first":first,"second":second,"difference":delta,"tolerance":a.tolerance,"pass":delta<=a.tolerance}))
sys.exit(0 if delta<=a.tolerance else 1)
