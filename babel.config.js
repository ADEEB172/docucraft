module.exports = {
  presets: ["next/babel"],
  plugins:
    process.env.DOCUCRAFT_COVERAGE === "1" ? ["istanbul"] : [],
};
