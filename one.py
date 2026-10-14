import argparse
import re
import zipfile
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def natural_key(text):
    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", text)
    ]


def chapter_number(path):
    match = re.search(r"(\d+)", path.stem)
    return int(match.group(1)) if match else 999999


def get_cbz_files(input_dir):
    return sorted(input_dir.glob("*.cbz"), key=lambda path: natural_key(path.name))


def split_chapters(chapters, chapters_per_volume):
    return [
        chapters[i : i + chapters_per_volume]
        for i in range(0, len(chapters), chapters_per_volume)
    ]


def add_cbz(output_zip, cbz_path, volume_chapter_index):
    with zipfile.ZipFile(cbz_path, "r") as source:
        files = sorted(source.namelist(), key=natural_key)

        page_index = 1

        for file in files:
            if file.endswith("/"):
                continue

            ext = Path(file).suffix.lower()

            if ext not in IMAGE_EXTENSIONS:
                continue

            with source.open(file) as image:
                new_name = (
                    f"Chapter_{volume_chapter_index:03d}/Page_{page_index:04d}{ext}"
                )
                output_zip.writestr(new_name, image.read())

            page_index += 1


def create_volume(output_dir, volume_index, chapters):
    first = chapter_number(chapters[0])
    last = chapter_number(chapters[-1])

    output_path = (
        output_dir / f"Volume_{volume_index:02d}_Chapters_{first:03d}-{last:03d}.cbz"
    )

    with zipfile.ZipFile(
        output_path, "w", compression=zipfile.ZIP_STORED
    ) as output_zip:
        for index, chapter in enumerate(chapters, start=1):
            print(f"  adding {chapter.name}")
            add_cbz(output_zip, chapter, index)

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Merge CBZ chapters into volumes.")
    parser.add_argument("input_dir", help="Folder containing .cbz files")
    parser.add_argument(
        "-o", "--output", default="generated_volumes", help="Output folder"
    )
    parser.add_argument("-n", "--chapters-per-volume", type=int, default=31)

    args = parser.parse_args()

    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output)

    if not output_dir.is_absolute():
        output_dir = input_dir / output_dir

    output_dir.mkdir(parents=True, exist_ok=True)

    chapters = get_cbz_files(input_dir)

    if not chapters:
        print("No .cbz files found.")
        return

    volumes = split_chapters(chapters, args.chapters_per_volume)

    print(f"Found {len(chapters)} chapters")
    print(f"Creating {len(volumes)} volumes")

    for volume_index, volume_chapters in enumerate(volumes, start=1):
        print(f"\nVolume {volume_index:02d}")
        output_path = create_volume(output_dir, volume_index, volume_chapters)
        print(f"created {output_path}")


if __name__ == "__main__":
    main()
