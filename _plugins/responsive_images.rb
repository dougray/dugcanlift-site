# frozen_string_literal: true

# Rewrites every <img> of this site's own images in the built pages:
#
# - width and height from the file, so the browser reserves the space before
#   the image arrives and the page doesn't jump (CSS `img { height: auto }` in
#   assets/main.scss keeps the shape when the image is scaled down);
# - loading="lazy" and decoding="async" on all but the first image of a page,
#   which is often in the first screen and should load straight away;
# - the .webp that script/webp writes next to a JPEG or PNG, when there is
#   one. Every browser this site supports reads WebP, so it replaces the src
#   outright; the original stays for share cards and anything that links it.
#
# Attributes a tag already has are left alone, and images on other sites are
# not touched. Standard library only: the size comes from the file headers.
module DugCanLift
  module ResponsiveImages
    IMG = /<img\b[^>]*>/i

    module_function

    def rewrite(html, site)
      first = true
      html.gsub(IMG) do |tag|
        src = tag[/\ssrc\s*=\s*"([^"]+)"/i, 1]
        path = src && local_file(src, site)
        next tag unless path

        attrs = +""
        unless tag =~ /\s(width|height)\s*=/i
          size = dimensions(path)
          attrs << %( width="#{size[0]}" height="#{size[1]}") if size
        end
        attrs << ' loading="lazy"' unless first || tag =~ /\sloading\s*=/i
        attrs << ' decoding="async"' unless tag =~ /\sdecoding\s*=/i
        first = false

        webp = path.sub(/\.(jpe?g|png)\z/i, ".webp")
        tag = tag.sub(src, src.sub(/\.(jpe?g|png)\z/i, ".webp")) if webp != path && File.file?(webp)
        tag.sub(/\A<img\b/i, "<img#{attrs}")
      end
    end

    def local_file(src, site)
      return nil if src =~ %r{\A(?:[a-z]+:)?//}i || src.start_with?("data:")

      url = src.split(/[?#]/, 2).first
      base = site.config["baseurl"].to_s
      url = url.delete_prefix(base) unless base.empty?
      return nil unless url.start_with?("/")

      path = File.join(site.source, url)
      File.file?(path) ? path : nil
    end

    # [width, height] read from a PNG, JPEG or WebP header, or nil.
    def dimensions(path)
      File.open(path, "rb") do |f|
        head = f.read(30) || ""
        if head.start_with?("\x89PNG".b)
          head[16, 8].unpack("NN")
        elsif head.start_with?("\xFF\xD8".b)
          jpeg(f)
        elsif head.start_with?("RIFF".b) && head[8, 4] == "WEBP"
          webp(head)
        end
      end
    rescue StandardError
      nil
    end

    def jpeg(f)
      f.seek(2)
      loop do
        marker = f.read(2)
        return nil unless marker && marker.getbyte(0) == 0xFF

        type = marker.getbyte(1)
        length = f.read(2).unpack1("n")
        # Start-of-frame markers carry the size; DHT, JPG and DAC don't.
        if (0xC0..0xCF).cover?(type) && ![0xC4, 0xC8, 0xCC].include?(type)
          height, width = f.read(5).unpack("xnn")
          return [width, height]
        end
        f.seek(length - 2, IO::SEEK_CUR)
      end
    end

    def webp(head)
      case head[12, 4]
      when "VP8 " then head[26, 4].unpack("vv").map { |v| v & 0x3FFF }
      when "VP8L"
        bits = head[21, 4].unpack1("V")
        [(bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1]
      when "VP8X"
        w = head[24, 3].bytes.each_with_index.sum { |b, i| b << (8 * i) }
        h = head[27, 3].bytes.each_with_index.sum { |b, i| b << (8 * i) }
        [w + 1, h + 1]
      end
    end
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |doc|
  next unless doc.output_ext == ".html" && doc.output&.include?("<img")

  doc.output = DugCanLift::ResponsiveImages.rewrite(doc.output, doc.site)
end
