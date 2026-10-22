/**
 * libxml2 (2.15, built by build.sh) and Lexbor through dom, simplexml, xml,
 * xmlreader and xmlwriter: parse and XPath, namespaces, DOM building and
 * saveXML, SimpleXML, the expat-style xml parser, XMLReader streaming,
 * XMLWriter, a libxml error, and HTML5 parsing with Dom\HTMLDocument.
 */
import { phpOk } from './lib/php.mjs';

export default async function (ctx) {
  const { assert } = ctx;
  const out = await phpOk(ctx, `<?php
$xml = '<?xml version="1.0"?><lib xmlns:b="urn:b"><book id="1"><title>PHP</title><b:price>10</b:price></book><book id="2"><title>WASI</title><b:price>32.5</b:price></book></lib>';
echo LIBXML_DOTTED_VERSION, "\\n";
$d = new DOMDocument(); $d->loadXML($xml); $x = new DOMXPath($d); $x->registerNamespace("b", "urn:b");
echo $x->evaluate("sum(//b:price)"), "|", $x->query("//book[@id='2']/title")->item(0)->textContent, "\\n";
$n = $d->createElement("book"); $n->setAttribute("id", "3"); $t = $d->createElement("title"); $t->appendChild($d->createTextNode("Fork & Pipe")); $n->appendChild($t); $d->documentElement->appendChild($n);
echo $d->getElementsByTagName("book")->length, "|", $d->saveXML($n), "\\n";
$s = simplexml_load_string($xml); echo count($s->book), "|", (string)$s->book[1]->title, "|", $s->book[0]["id"], "|", (string)$s->book[0]->children("urn:b")->price, "\\n";
$names = []; $p = xml_parser_create(); xml_set_element_handler($p, function ($p, $n) use (&$names) { $names[] = $n; }, fn() => null); xml_parse($p, $xml, true); echo implode(",", array_unique($names)), "\\n";
$r = XMLReader::XML($xml); $ids = []; while ($r->read()) if ($r->nodeType === XMLReader::ELEMENT && $r->name === "book") $ids[] = $r->getAttribute("id"); echo implode(",", $ids), "\\n";
$w = new XMLWriter(); $w->openMemory(); $w->startDocument("1.0", "UTF-8"); $w->startElement("r"); $w->writeAttribute("a", "<&>"); $w->text("ünï"); $w->endElement(); $w->endDocument(); echo trim($w->outputMemory()), "\\n";
libxml_use_internal_errors(true); var_dump(simplexml_load_string("<a><b></a>")); echo trim(libxml_get_errors()[0]->message), "\\n";
$h = Dom\\HTMLDocument::createFromString('<!doctype html><title>t</title><p class=x>one<p>two<table><td>cell</table>', LIBXML_NOERROR);
echo $h->querySelectorAll("p")->length, "|", $h->querySelector("td")->textContent, "|", $h->querySelector(".x")->textContent, "|", $h->title, "\\n";
$xd = Dom\\XMLDocument::createFromString($xml); echo $xd->documentElement->firstElementChild->getAttribute("id"), "\\n";
`);
  assert.equal(out, [
    '2.15.4',
    '42.5|WASI',
    '3|<book id="3"><title>Fork &amp; Pipe</title></book>',
    '2|WASI|1|10',
    'LIB,BOOK,TITLE,B:PRICE',
    '1,2',
    '<?xml version="1.0" encoding="UTF-8"?>\n<r a="&lt;&amp;&gt;">ünï</r>',
    'bool(false)',
    'Opening and ending tag mismatch: b line 1 and a',
    '2|cell|one|t',
    '1',
    '',
  ].join('\n'));
}
