# Databricks notebook source
from pyspark import pipelines as dp

@dp.table
def fixture_table():
    return spark.range(1)
