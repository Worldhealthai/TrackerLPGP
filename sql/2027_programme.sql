-- ===========================================================================
-- LPGP Connect — 2027 programme
--
-- Loads the published 2027 schedule (7 series, 20 events) into
-- portfolio_events so deals can be allocated against the proper event names,
-- and so the sales CRM's Event Performance page has them to target.
--
-- Run in the tracker's Postgres (Neon → SQL editor, or psql $DATABASE_URL).
-- Idempotent: matched on name + location, so re-running adds nothing.
--
-- Dates are the 1st of the confirmed month — the brochure lists the day as
-- TBC. Edit each row's date as the programme firms up; that does not affect
-- any deal already allocated to the event.
-- ===========================================================================

INSERT INTO portfolio_events (name, event_date, location, notes)
SELECT v.name, v.event_date, v.location, v.notes
FROM (VALUES
  ('11th Annual Private Debt Europe', DATE '2027-03-01', 'Berlin, Germany', '01 Private Debt Fundraising Series · March 2027 (day TBC)'),
  ('13th Annual Private Debt — In Partnership with Women in Private Debt', DATE '2027-04-01', 'New York, USA', '01 Private Debt Fundraising Series · April 2027 (day TBC)'),
  ('13th Annual Private Debt — In Partnership with Women in Private Debt', DATE '2027-09-01', 'London, UK', '01 Private Debt Fundraising Series · September 2027 (day TBC)'),
  ('2nd Annual Sports Investing Forum', DATE '2027-10-01', 'London, UK', '01 Private Debt Fundraising Series · October 2027 (day TBC)'),
  ('12th Annual Private Debt', DATE '2027-10-01', 'Chicago, USA', '01 Private Debt Fundraising Series · October 2027 (day TBC)'),
  ('4th Annual Private Debt', DATE '2027-10-01', 'Los Angeles, USA', '01 Private Debt Fundraising Series · October 2027 (day TBC)'),
  ('Sports Investing Forum', DATE '2027-11-01', 'New York, USA', '01 Private Debt Fundraising Series · November 2027 (day TBC)'),
  ('4th Annual CFO/COO Private Markets', DATE '2027-03-01', 'Switzerland', '02 CFO / COO Private Markets Series · March 2027 (day TBC)'),
  ('4th Annual CFO/COO Private Markets', DATE '2027-05-01', 'Miami, USA', '02 CFO / COO Private Markets Series · May 2027 (day TBC)'),
  ('4th Annual CFO/COO Private Markets', DATE '2027-10-01', 'Los Angeles, USA', '02 CFO / COO Private Markets Series · October 2027 (day TBC)'),
  ('9th Annual CFO–COO Private Equity & Debt Conference', DATE '2027-07-01', 'London, UK', '03 CFO / COO Private Equity & Debt Conference Series · July 2027 (day TBC)'),
  ('9th Annual CFO/COO Private Equity & Debt Conference', DATE '2027-10-01', 'Chicago, USA', '03 CFO / COO Private Equity & Debt Conference Series · October 2027 (day TBC)'),
  ('8th Annual CFO–COO Private Equity & Debt Conference', DATE '2027-11-01', 'New York, USA', '03 CFO / COO Private Equity & Debt Conference Series · November 2027 (day TBC)'),
  ('5th Annual CFO/COO Private Equity', DATE '2027-06-01', 'San Francisco, USA', '04 CFO / COO Private Equity · June 2027 (day TBC)'),
  ('2nd Annual Operating Partners Summit', DATE '2027-02-01', 'Miami, USA', '05 Operating Partners Conference Series · February 2027 (day TBC)'),
  ('3rd Annual Operating Partners Summit', DATE '2027-05-01', 'New York, USA', '05 Operating Partners Conference Series · May 2027 (day TBC)'),
  ('3rd Annual Operating Partners Summit', DATE '2027-11-01', 'West Coast, USA', '05 Operating Partners Conference Series · November 2027 (day TBC)'),
  ('3rd Annual AI, Data & Tech in Private Markets', DATE '2027-05-01', 'New York, USA', '06 Data & Technology Forum Series · May 2027 (day TBC)'),
  ('3rd Annual AI, Data & Tech in Private Markets', DATE '2027-10-01', 'London, UK', '06 Data & Technology Forum Series · October 2027 (day TBC)'),
  ('5th Annual Operational Fund Summit', DATE '2027-11-01', 'Luxembourg', '07 Operational Fund Summit Series · November 2027 (day TBC)')
) AS v(name, event_date, location, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM portfolio_events pe
  WHERE lower(pe.name) = lower(v.name)
    AND lower(COALESCE(pe.location, '')) = lower(v.location)
);

-- ---------------------------------------------------------------------------
-- Optional: rename earlier shorthand events to the canonical titles.
--
-- Renaming keeps the event's id, so every deal already allocated to it stays
-- allocated — nothing is re-pointed and no revenue moves. Uncomment only the
-- lines that match your data, and check the ambiguous ones first: several
-- cities host more than one event in a cycle ("Chicago" is both a Private Debt
-- and a CFO/COO PE & Debt conference), so those cannot be renamed blindly.
-- ---------------------------------------------------------------------------

-- UPDATE portfolio_events SET name = '11th Annual Private Debt Europe',         location = 'Berlin, Germany'    WHERE name = 'Berlin';
-- UPDATE portfolio_events SET name = '4th Annual CFO/COO Private Markets',      location = 'Switzerland'        WHERE name = 'Switzerland';
-- UPDATE portfolio_events SET name = '5th Annual CFO/COO Private Equity',       location = 'San Francisco, USA' WHERE name = 'CFO Sanfran';
-- UPDATE portfolio_events SET name = '5th Annual Operational Fund Summit',      location = 'Luxembourg'         WHERE name = 'Lux';
-- UPDATE portfolio_events SET name = '2nd Annual Operating Partners Summit',    location = 'Miami, USA'         WHERE name = 'Ops Miami';
-- UPDATE portfolio_events SET name = '3rd Annual Operating Partners Summit',    location = 'West Coast, USA'    WHERE name = 'OPS LA';
-- UPDATE portfolio_events SET name = '4th Annual CFO/COO Private Markets',      location = 'Miami, USA'         WHERE name = 'CFO Miami';

-- After running, open the sales CRM → Event performance. Any event whose
-- series it can infer from the name is offered for one-click confirmation.
