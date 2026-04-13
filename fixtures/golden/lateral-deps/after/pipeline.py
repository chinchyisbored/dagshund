# Databricks notebook source
import dlt


@dlt.table
def placeholder():
    return spark.range(1)
