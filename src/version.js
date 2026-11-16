const CommitUrl = "https://github.com/mattgodbolt/owlet-editor/commit/";
const ShortShaLength = 7;

export function describeBuild(sha, date) {
    if (!sha) return {label: "dev build", url: null};
    const label = `${sha.slice(0, ShortShaLength)}${date ? `, built ${date}` : ""}`;
    return {label, url: `${CommitUrl}${sha}`};
}
