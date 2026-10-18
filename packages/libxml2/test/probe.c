#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/xmlversion.h>
#include <libxml/xpath.h>
#include <libxml/xmlsave.h>
#include <stdio.h>
#include <string.h>

#define CHECK(c, m) do { if (!(c)) { printf("FAIL %s\n", m); return 1; } } while (0)

static const char DOC[] =
  "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n"
  "<shelf><book id=\"1\" lang=\"fr\"><title>Na\xefve caf\xe9</title><price>12.5</price></book>"
  "<book id=\"2\"><title>Plain</title><price>7</price></book><!-- c --></shelf>\n";

int main(int argc, char **argv) {
  LIBXML_TEST_VERSION
  xmlDocPtr doc = xmlReadMemory(DOC, sizeof DOC - 1, "shelf.xml", NULL, XML_PARSE_NONET);
  CHECK(doc, "xmlReadMemory");
  xmlXPathContextPtr ctx = xmlXPathNewContext(doc);
  xmlXPathObjectPtr sum = xmlXPathEvalExpression(BAD_CAST "sum(//price)", ctx);
  CHECK(sum && sum->type == XPATH_NUMBER && sum->floatval == 19.5, "XPath sum(//price)");
  xmlXPathObjectPtr t = xmlXPathEvalExpression(BAD_CAST "string(//book[@lang='fr']/title)", ctx);
  CHECK(t && t->type == XPATH_STRING && !strcmp((char *)t->stringval, "Na\xc3\xafve caf\xc3\xa9"), "ISO-8859-1 text reads back as UTF-8");
  xmlXPathObjectPtr ns = xmlXPathEvalExpression(BAD_CAST "//book", ctx);
  CHECK(ns && ns->nodesetval && ns->nodesetval->nodeNr == 2, "two books");
  xmlNodePtr b = xmlNewChild(xmlDocGetRootElement(doc), NULL, BAD_CAST "book", NULL);
  xmlNewProp(b, BAD_CAST "id", BAD_CAST "3");
  xmlNewTextChild(b, NULL, BAD_CAST "title", BAD_CAST "\xe6\x97\xa5\xe6\x9c\xac & <more>");
  char path[512];
  snprintf(path, sizeof path, "%s/probe.xml", argc > 1 ? argv[1] : ".");
  CHECK(xmlSaveFormatFileEnc(path, doc, "UTF-16", 1) > 0, "save as UTF-16");
  xmlDocPtr again = xmlReadFile(path, NULL, XML_PARSE_NONET);
  CHECK(again, "re-read the UTF-16 file");
  xmlXPathContextPtr c2 = xmlXPathNewContext(again);
  xmlXPathObjectPtr t3 = xmlXPathEvalExpression(BAD_CAST "string(//book[@id='3']/title)", c2);
  CHECK(t3 && !strcmp((char *)t3->stringval, "\xe6\x97\xa5\xe6\x9c\xac & <more>"), "escaped CJK text round-trips through UTF-16");
  xmlDocPtr bad = xmlReadMemory("<a><b></a>", 10, "bad.xml", NULL, XML_PARSE_NONET | XML_PARSE_NOERROR | XML_PARSE_NOWARNING);
  CHECK(!bad, "malformed XML is refused");
  xmlXPathFreeObject(sum); xmlXPathFreeObject(t); xmlXPathFreeObject(ns); xmlXPathFreeObject(t3);
  xmlXPathFreeContext(ctx); xmlXPathFreeContext(c2);
  xmlFreeDoc(doc); xmlFreeDoc(again);
  printf("libxml2 %s\n", LIBXML_DOTTED_VERSION);
  printf("probe ok\n");
  return 0;
}
